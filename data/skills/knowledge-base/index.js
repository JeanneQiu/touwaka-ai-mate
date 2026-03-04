/**
 * Knowledge Base Skill - 知识库管理技能
 *
 * 提供知识库的创建、文档导入、向量化和语义检索能力。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 默认配置
const DEFAULT_CONFIG = {
  apiBase: process.env.KB_API_BASE || 'http://localhost:3000/api',
  maxChunkTokens: 500,
  chunkOverlap: 50,
  embeddingBatchSize: 10,
};

// 允许导入的文件类型
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt', '.html', '.markdown'];

// 最大文件大小 (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 主执行函数
 */
async function execute(toolName, params, context = {}) {
  const config = { ...DEFAULT_CONFIG, ...context.config };

  switch (toolName) {
    // 知识库管理
    case 'kb-list':
      return await kbList(params, config, context);
    case 'kb-get':
      return await kbGet(params, config, context);
    case 'kb-create':
      return await kbCreate(params, config, context);

    // 文档导入
    case 'kb-import-file':
      return await kbImportFile(params, config, context);
    case 'kb-import-web':
      return await kbImportWeb(params, config, context);

    // 知识点管理
    case 'kb-chunk-text':
      return await kbChunkText(params, config, context);
    case 'kb-create-point':
      return await kbCreatePoint(params, config, context);

    // 向量化
    case 'kb-embed':
      return await kbEmbed(params, config, context);

    // 检索
    case 'kb-search-vector':
      return await kbSearchVector(params, config, context);
    case 'kb-get-point':
      return await kbGetPoint(params, config, context);
    case 'kb-get-knowledge':
      return await kbGetKnowledge(params, config, context);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================
// 知识库管理
// ============================================================

/**
 * kb-list: 获取知识库列表
 */
async function kbList(params, config, context) {
  const result = await apiRequest('GET', '/kb', null, context);
  return result;
}

/**
 * kb-get: 获取知识库详情
 */
async function kbGet(params, config, context) {
  const { kb_id } = params;
  if (!kb_id) {
    throw new Error('kb_id is required');
  }
  const result = await apiRequest('GET', `/kb/${kb_id}`, null, context);
  return result;
}

/**
 * kb-create: 创建知识库
 */
async function kbCreate(params, config, context) {
  const { name, description, embedding_model_id } = params;
  if (!name) {
    throw new Error('name is required');
  }
  const result = await apiRequest('POST', '/kb', {
    name,
    description,
    embedding_model_id,
  }, context);
  return result;
}

// ============================================================
// 文档导入
// ============================================================

/**
 * kb-import-file: 导入文件到知识库
 */
async function kbImportFile(params, config, context) {
  const { file_path, kb_id, parent_id, title } = params;

  if (!file_path || !kb_id) {
    throw new Error('file_path and kb_id are required');
  }

  // 验证文件
  const resolvedPath = resolveFilePath(file_path, context);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  // 解析文件内容
  const parsedContent = await parseFile(resolvedPath, ext, context);

  // 创建文章
  const articleTitle = title || path.basename(resolvedPath, ext);
  const knowledge = await apiRequest('POST', `/kb/${kb_id}/knowledges`, {
    parent_id,
    title: articleTitle,
    summary: parsedContent.summary,
    source_type: 'file',
    file_path: resolvedPath,
  }, context);

  // 创建知识点
  const chunks = chunkText(parsedContent.content, config.maxChunkTokens, config.chunkOverlap);
  let pointCount = 0;

  for (const chunk of chunks) {
    try {
      await apiRequest('POST', `/kb/${kb_id}/knowledges/${knowledge.id}/points`, {
        title: chunk.title,
        content: chunk.content,
        context: `本文档属于"${articleTitle}"`,
      }, context);
      pointCount++;
    } catch (error) {
      console.error(`Failed to create point: ${error.message}`);
    }
  }

  return {
    knowledge_id: knowledge.id,
    title: articleTitle,
    point_count: pointCount,
    source_type: 'file',
    file_path: resolvedPath,
  };
}

/**
 * kb-import-web: 导入网页内容
 */
async function kbImportWeb(params, config, context) {
  const { url, kb_id, parent_id } = params;

  if (!url || !kb_id) {
    throw new Error('url and kb_id are required');
  }

  // 抓取网页内容
  const webContent = await fetchWebContent(url);

  // 创建文章
  const knowledge = await apiRequest('POST', `/kb/${kb_id}/knowledges`, {
    parent_id,
    title: webContent.title,
    summary: webContent.summary,
    source_type: 'web',
    source_url: url,
  }, context);

  // 创建知识点
  const chunks = chunkText(webContent.content, config.maxChunkTokens, config.chunkOverlap);
  let pointCount = 0;

  for (const chunk of chunks) {
    try {
      await apiRequest('POST', `/kb/${kb_id}/knowledges/${knowledge.id}/points`, {
        title: chunk.title,
        content: chunk.content,
        context: `本文档来自网页"${webContent.title}"，URL: ${url}`,
      }, context);
      pointCount++;
    } catch (error) {
      console.error(`Failed to create point: ${error.message}`);
    }
  }

  return {
    knowledge_id: knowledge.id,
    title: webContent.title,
    point_count: pointCount,
    source_type: 'web',
    source_url: url,
  };
}

// ============================================================
// 知识点管理
// ============================================================

/**
 * kb-chunk-text: 文本分块
 */
async function kbChunkText(params, config, context) {
  const { text, max_tokens = config.maxChunkTokens, overlap = config.chunkOverlap } = params;

  if (!text) {
    throw new Error('text is required');
  }

  const chunks = chunkText(text, max_tokens, overlap);
  return {
    total_chunks: chunks.length,
    chunks: chunks.map((c, i) => ({
      index: i + 1,
      title: c.title,
      content: c.content,
      token_count: c.tokenCount,
    })),
  };
}

/**
 * kb-create-point: 创建知识点
 */
async function kbCreatePoint(params, config, context) {
  const { knowledge_id, title, content, context: ctx } = params;

  if (!knowledge_id || !content) {
    throw new Error('knowledge_id and content are required');
  }

  // 从 context 中获取 kb_id
  const kb_id = context.kb_id || params.kb_id;
  if (!kb_id) {
    throw new Error('kb_id is required (from params or context)');
  }

  const result = await apiRequest('POST', `/kb/${kb_id}/knowledges/${knowledge_id}/points`, {
    title,
    content,
    context: ctx,
  }, context);

  return result;
}

// ============================================================
// 向量化
// ============================================================

/**
 * kb-embed: 生成向量嵌入
 */
async function kbEmbed(params, config, context) {
  const { kb_id, point_ids } = params;

  if (!kb_id) {
    throw new Error('kb_id is required');
  }

  // 获取知识库配置（包含 embedding 模型信息）
  const kbInfo = await apiRequest('GET', `/kb/${kb_id}`, null, context);

  // 获取需要向量化的知识点
  let points = [];
  if (point_ids && point_ids.length > 0) {
    // 获取指定的知识点
    for (const pid of point_ids) {
      const point = await apiRequest('GET', `/kb/${kb_id}/points/${pid}`, null, context);
      points.push(point);
    }
  } else {
    // 获取所有未向量化的知识点
    // 注意：这里需要后端支持查询未向量化的知识点
    // 暂时通过获取所有知识点来模拟
    const knowledges = await apiRequest('GET', `/kb/${kb_id}/knowledges/tree`, null, context);
    points = await collectPointsWithoutEmbedding(kb_id, knowledges, context);
  }

  if (points.length === 0) {
    return { total: 0, success: 0, failed: 0, message: 'No points to embed' };
  }

  // 批量生成向量
  let success = 0;
  let failed = 0;

  for (let i = 0; i < points.length; i += config.embeddingBatchSize) {
    const batch = points.slice(i, i + config.embeddingBatchSize);

    for (const point of batch) {
      try {
        // 准备向量化文本
        const textForEmbedding = prepareTextForEmbedding(point);

        // 调用 embedding API
        const embedding = await generateEmbedding(textForEmbedding, kbInfo, context);

        // 更新知识点的向量
        await updatePointEmbedding(kb_id, point.id, embedding, context);
        success++;
      } catch (error) {
        console.error(`Failed to embed point ${point.id}: ${error.message}`);
        failed++;
      }
    }
  }

  return {
    total: points.length,
    success,
    failed,
  };
}

// ============================================================
// 检索
// ============================================================

/**
 * kb-search-vector: 向量语义检索
 */
async function kbSearchVector(params, config, context) {
  const { query, kb_id, top_k = 10, threshold = 0.7 } = params;

  if (!query) {
    throw new Error('query is required');
  }

  // 获取 embedding（用于查询）
  let kbInfo = null;
  if (kb_id) {
    kbInfo = await apiRequest('GET', `/kb/${kb_id}`, null, context);
  }

  // 生成查询向量
  const queryEmbedding = await generateEmbedding(query, kbInfo, context);

  // 检索相似知识点
  const results = await searchSimilarPoints(queryEmbedding, kb_id, top_k, threshold, context);

  return {
    query,
    total: results.length,
    results: results.map(r => ({
      point_id: r.id,
      title: r.title,
      content_preview: r.content?.substring(0, 200) + (r.content?.length > 200 ? '...' : ''),
      similarity: r.similarity,
      knowledge_id: r.knowledge_id,
      knowledge_title: r.knowledge_title,
    })),
  };
}

/**
 * kb-get-point: 获取知识点详情
 */
async function kbGetPoint(params, config, context) {
  const { point_id, kb_id } = params;

  if (!point_id) {
    throw new Error('point_id is required');
  }

  // 如果没有提供 kb_id，需要通过其他方式获取
  const kbIdToUse = kb_id || context.kb_id;
  if (!kbIdToUse) {
    throw new Error('kb_id is required');
  }

  // 获取知识点详情需要 knowledge_id，这里简化处理
  // 实际应该有一个直接的 API 来获取单个知识点
  const result = await apiRequest('GET', `/kb/${kbIdToUse}/points/${point_id}`, null, context);
  return result;
}

/**
 * kb-get-knowledge: 获取文章详情
 */
async function kbGetKnowledge(params, config, context) {
  const { knowledge_id, kb_id, include_points = false } = params;

  if (!knowledge_id || !kb_id) {
    throw new Error('knowledge_id and kb_id are required');
  }

  const result = await apiRequest('GET', `/kb/${kb_id}/knowledges/${knowledge_id}`, null, context);

  if (include_points) {
    const points = await apiRequest('GET', `/kb/${kb_id}/knowledges/${knowledge_id}/points`, null, context);
    result.points = points.items || points;
  }

  return result;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 发送 API 请求
 */
async function apiRequest(method, apiPath, data, context) {
  const baseUrl = context.apiBase || DEFAULT_CONFIG.apiBase;
  const url = new URL(apiPath, baseUrl);

  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // 添加认证头
  if (context.authToken) {
    options.headers['Authorization'] = `Bearer ${context.authToken}`;
  }
  if (context.userId) {
    options.headers['X-User-Id'] = context.userId;
  }

  return new Promise((resolve, reject) => {
    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${json.message || body}`));
          } else {
            resolve(json.data || json);
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * 解析文件路径
 */
function resolveFilePath(filePath, context) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // 尝试相对于数据目录解析
  const dataPath = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
  const resolved = path.join(dataPath, filePath);

  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // 尝试相对于当前工作目录
  return path.resolve(filePath);
}

/**
 * 解析文件内容
 */
async function parseFile(filePath, ext, context) {
  const content = fs.readFileSync(filePath, 'utf-8');

  switch (ext) {
    case '.md':
    case '.markdown':
    case '.txt':
      return parseMarkdown(content);

    case '.html':
      return parseHtml(content);

    case '.pdf':
    case '.docx':
      // PDF 和 DOCX 需要调用专门的解析技能
      return await parseDocumentWithSkill(filePath, ext, context);

    default:
      return {
        title: path.basename(filePath, ext),
        content: content,
        summary: content.substring(0, 200),
      };
  }
}

/**
 * 解析 Markdown
 */
function parseMarkdown(content) {
  const lines = content.split('\n');
  let title = 'Untitled';

  // 提取第一个标题作为标题
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.substring(2).trim();
      break;
    }
  }

  return {
    title,
    content,
    summary: lines.slice(0, 10).join('\n').substring(0, 500),
  };
}

/**
 * 解析 HTML
 */
function parseHtml(content) {
  // 简单的 HTML 解析
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

  // 移除 HTML 标签
  const text = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    content: text,
    summary: text.substring(0, 500),
  };
}

/**
 * 使用技能解析文档
 */
async function parseDocumentWithSkill(filePath, ext, context) {
  // 这里应该调用 PDF 或 DOCX 技能
  // 暂时返回提示信息
  throw new Error(`Document parsing for ${ext} files requires calling the corresponding skill. ` +
    `Please use the ${ext === '.pdf' ? 'pdf' : 'docx'} skill first to extract text.`);
}

/**
 * 文本分块
 */
function chunkText(text, maxTokens = 500, overlap = 50) {
  const chunks = [];

  // 按段落分割
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // 如果单个段落就超过限制，需要进一步分割
    if (paraTokens > maxTokens) {
      // 先保存当前块
      if (currentChunk.trim()) {
        chunks.push(createChunk(currentChunk, chunkIndex++));
      }

      // 分割大段落
      const subChunks = splitLargeParagraph(para, maxTokens, overlap);
      for (const sub of subChunks) {
        chunks.push(createChunk(sub, chunkIndex++));
      }

      currentChunk = '';
      currentTokens = 0;
    } else if (currentTokens + paraTokens > maxTokens) {
      // 当前块已满，保存并开始新块
      if (currentChunk.trim()) {
        chunks.push(createChunk(currentChunk, chunkIndex++));
      }
      currentChunk = para + '\n\n';
      currentTokens = paraTokens;
    } else {
      currentChunk += para + '\n\n';
      currentTokens += paraTokens;
    }
  }

  // 保存最后一块
  if (currentChunk.trim()) {
    chunks.push(createChunk(currentChunk, chunkIndex));
  }

  return chunks;
}

/**
 * 分割大段落
 */
function splitLargeParagraph(text, maxTokens, overlap) {
  const sentences = text.split(/[。！？.!?]+/);
  const chunks = [];
  let current = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentTokens = estimateTokens(sentence);

    if (currentTokens + sentTokens > maxTokens) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = sentence;
      currentTokens = sentTokens;
    } else {
      current += sentence;
      currentTokens += sentTokens;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * 创建块对象
 */
function createChunk(content, index) {
  // 尝试从内容中提取标题
  const lines = content.trim().split('\n');
  let title = `知识点 ${index + 1}`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      title = trimmed.substring(2);
      break;
    } else if (trimmed.length > 0 && trimmed.length < 100) {
      title = trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : '');
      break;
    }
  }

  return {
    title,
    content: content.trim(),
    tokenCount: estimateTokens(content),
  };
}

/**
 * 估算 token 数量
 */
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 抓取网页内容
 */
async function fetchWebContent(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;

    httpModule.get(url, { timeout: 30000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const parsed = parseHtml(body);
        resolve(parsed);
      });
    }).on('error', reject);
  });
}

/**
 * 准备向量化文本
 */
function prepareTextForEmbedding(point) {
  const parts = [];

  if (point.context) {
    parts.push(`[上下文] ${point.context}`);
  }

  if (point.title) {
    parts.push(`[标题] ${point.title}`);
  }

  parts.push(`[内容] ${point.content}`);

  return parts.join('\n\n');
}

/**
 * 生成向量嵌入
 */
async function generateEmbedding(text, kbInfo, context) {
  // 获取 embedding 模型配置
  const embeddingModel = kbInfo?.embedding_model_id || context.embeddingModelId;

  // 如果没有配置外部模型，尝试使用本地 embedding
  if (!embeddingModel || embeddingModel === 'local' || embeddingModel === 'local:all-MiniLM-L6-v2') {
    try {
      // 动态导入本地 embedding 服务
      const localEmbedding = await import('../../../lib/local-embedding.js');
      if (localEmbedding.isLocalModelAvailable()) {
        const embeddings = await localEmbedding.generateEmbedding(text);
        if (embeddings && embeddings[0]) {
          return embeddings[0];
        }
      }
    } catch (e) {
      console.error('[KB] Local embedding failed:', e.message);
    }
  }

  // 如果本地失败或配置了外部模型，使用外部 API
  const apiUrl = process.env.EMBEDDING_API_URL || context.embeddingApiUrl;
  const apiKey = process.env.EMBEDDING_API_KEY || context.embeddingApiKey;
  const modelName = process.env.EMBEDDING_MODEL || context.embeddingModel || 'text-embedding-3-small';

  if (apiUrl && apiKey) {
    return await callEmbeddingApi(apiUrl, apiKey, modelName, text);
  }

  throw new Error('No embedding service available. Local model failed and no external API configured.');
}

/**
 * 调用 Embedding API
 */
async function callEmbeddingApi(apiUrl, apiKey, modelName, text) {
  const url = new URL(apiUrl);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const requestBody = JSON.stringify({
    input: text,
    model: modelName,
  });

  return new Promise((resolve, reject) => {
    const req = httpModule.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/embeddings`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Embedding API error: ${res.statusCode} ${body}`));
            return;
          }
          const json = JSON.parse(body);
          const embedding = json.data?.[0]?.embedding;
          if (!embedding) {
            reject(new Error('No embedding in response'));
            return;
          }
          resolve(embedding);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Embedding API timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 更新知识点向量
 */
async function updatePointEmbedding(kbId, pointId, embedding, context) {
  // 将向量存储为 JSON
  const embeddingJson = JSON.stringify(embedding);

  // 这里需要后端支持更新 embedding 字段
  // 暂时通过直接数据库操作或扩展 API
  await apiRequest('PUT', `/kb/${kbId}/points/${pointId}`, {
    embedding: embeddingJson,
  }, context);
}

/**
 * 收集未向量化的知识点
 */
async function collectPointsWithoutEmbedding(kbId, knowledges, context) {
  const points = [];

  async function traverse(node) {
    if (Array.isArray(node)) {
      for (const item of node) {
        await traverse(item);
      }
    } else if (node) {
      // 获取该文章的知识点
      try {
        const pts = await apiRequest('GET', `/kb/${kbId}/knowledges/${node.id}/points`, null, context);
        for (const pt of (pts.items || pts)) {
          // 检查是否有 embedding
          if (!pt.embedding) {
            points.push({
              ...pt,
              knowledge_title: node.title,
            });
          }
        }
      } catch (error) {
        console.error(`Failed to get points for knowledge ${node.id}: ${error.message}`);
      }

      // 递归处理子节点
      if (node.children) {
        await traverse(node.children);
      }
    }
  }

  await traverse(knowledges);
  return points;
}

/**
 * 向量相似度搜索
 */
async function searchSimilarPoints(queryEmbedding, kbId, topK, threshold, context) {
  // 获取知识点
  let allPoints = [];

  if (kbId) {
    const knowledges = await apiRequest('GET', `/kb/${kbId}/knowledges/tree`, null, context);
    allPoints = await collectAllPoints(kbId, knowledges, context);
  } else {
    // 搜索所有知识库
    const kbs = await apiRequest('GET', '/kb', null, context);
    for (const kb of (kbs.items || kbs)) {
      const knowledges = await apiRequest('GET', `/kb/${kb.id}/knowledges/tree`, null, context);
      const pts = await collectAllPoints(kb.id, knowledges, context);
      allPoints.push(...pts);
    }
  }

  // 计算相似度
  const results = [];
  for (const point of allPoints) {
    if (!point.embedding) continue;

    try {
      const embedding = JSON.parse(point.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= threshold) {
        results.push({
          ...point,
          similarity,
        });
      }
    } catch (error) {
      console.error(`Failed to parse embedding for point ${point.id}`);
    }
  }

  // 排序并返回 Top-K
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * 收集所有知识点
 */
async function collectAllPoints(kbId, knowledges, context) {
  const points = [];

  async function traverse(node) {
    if (Array.isArray(node)) {
      for (const item of node) {
        await traverse(item);
      }
    } else if (node) {
      try {
        const pts = await apiRequest('GET', `/kb/${kbId}/knowledges/${node.id}/points`, null, context);
        for (const pt of (pts.items || pts)) {
          points.push({
            ...pt,
            knowledge_title: node.title,
          });
        }
      } catch (error) {
        console.error(`Failed to get points for knowledge ${node.id}`);
      }

      if (node.children) {
        await traverse(node.children);
      }
    }
  }

  await traverse(knowledges);
  return points;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

module.exports = { execute };