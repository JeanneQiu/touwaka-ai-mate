---
name: knowledge-base
description: 知识库管理技能，用于导入文档、生成知识点、向量化和语义检索。支持 PDF、Word、Markdown 等格式文档导入，自动分块生成知识点，并可进行向量语义搜索。
license: MIT
argument-hint: "[tool] [params]"
user-invocable: true
tools:
  - kb-list
  - kb-get
  - kb-create
  - kb-update
  - kb-delete
  - kb-import-file
  - kb-import-web
  - kb-chunk-text
  - kb-create-point
  - kb-update-point
  - kb-delete-point
  - kb-get-knowledge
  - kb-update-knowledge
  - kb-delete-knowledge
  - kb-embed
  - kb-search-vector
  - kb-get-point
---

# Knowledge Base Skill

知识库管理技能，提供完整的知识库管理能力。

## 工具列表

### 知识库管理

#### kb-list
获取用户可访问的知识库列表。

**参数**: 无

**返回**:
```json
[
  { "id": 1, "name": "财务知识库", "description": "...", "point_count": 156 }
]
```

#### kb-get
获取知识库详情。

**参数**:
- `kb_id`: 知识库ID

#### kb-create
创建新知识库。

**参数**:
- `name`: 知识库名称
- `description`: 描述（可选）
- `embedding_model_id`: 向量模型ID（可选）

#### kb-update
更新知识库信息。

**参数**:
- `kb_id`: 知识库ID
- `name`: 知识库名称（可选）
- `description`: 描述（可选）
- `embedding_model_id`: 向量模型ID（可选）

#### kb-delete
删除知识库。

**参数**:
- `kb_id`: 知识库ID

### 文档导入

#### kb-import-file
导入文件到知识库，自动解析并创建知识点。

**参数**:
- `file_path`: 文件路径（支持 .pdf, .docx, .md, .txt, .html）
- `kb_id`: 知识库ID
- `parent_id`: 父文章ID（可选）
- `title`: 文章标题（可选，默认从文件名提取）

**返回**:
```json
{
  "knowledge_id": 123,
  "title": "文档标题",
  "point_count": 15
}
```

#### kb-import-web
导入网页内容到知识库。

**参数**:
- `url`: 网页URL
- `kb_id`: 知识库ID
- `parent_id`: 父文章ID（可选）

### 知识点管理

#### kb-chunk-text
将文本智能分块。

**参数**:
- `text`: 待分块的文本
- `max_tokens`: 每块最大 token 数（默认 500）
- `overlap`: 重叠 token 数（默认 50）

**返回**:
```json
{
  "chunks": [
    { "content": "...", "token_count": 450 },
    { "content": "...", "token_count": 380 }
  ]
}
```

#### kb-create-point
创建知识点。

**参数**:
- `knowledge_id`: 所属文章ID
- `kb_id`: 知识库ID
- `title`: 标题（可选）
- `content`: Markdown 内容
- `context`: 上下文信息（可选）

#### kb-update-point
更新知识点。

**参数**:
- `kb_id`: 知识库ID
- `knowledge_id`: 所属文章ID
- `point_id`: 知识点ID
- `title`: 标题（可选）
- `content`: Markdown 内容（可选）
- `context`: 上下文信息（可选）

#### kb-delete-point
删除知识点。

**参数**:
- `kb_id`: 知识库ID
- `knowledge_id`: 所属文章ID
- `point_id`: 知识点ID

### 文章管理

#### kb-get-knowledge
获取文章详情。

**参数**:
- `kb_id`: 知识库ID
- `knowledge_id`: 文章ID
- `include_points`: 是否包含知识点列表（默认 false）

#### kb-update-knowledge
更新文章。

**参数**:
- `kb_id`: 知识库ID
- `knowledge_id`: 文章ID
- `title`: 文章标题（可选）
- `summary`: 摘要（可选）
- `status`: 状态（可选，如 'pending', 'completed'）

#### kb-delete-knowledge
删除文章。

**参数**:
- `kb_id`: 知识库ID
- `knowledge_id`: 文章ID

### 向量化

#### kb-embed
为知识点生成向量嵌入。

**参数**:
- `kb_id`: 知识库ID
- `point_ids`: 指定知识点ID列表（可选，不传则处理所有未向量化的知识点）

**返回**:
```json
{
  "total": 15,
  "success": 15,
  "failed": 0
}
```

### 检索

#### kb-search-vector
向量语义检索。

**参数**:
- `query`: 搜索查询（自然语言）
- `kb_id`: 知识库ID（可选）
- `top_k`: 返回数量（默认 10）
- `threshold`: 相似度阈值（默认 0.1，适用于 all-MiniLM-L6-v2 模型）

**返回**:
```json
{
  "results": [
    {
      "point_id": 456,
      "title": "知识点标题",
      "content_preview": "内容预览...",
      "similarity": 0.89,
      "knowledge_id": 123,
      "knowledge_title": "所属文章标题"
    }
  ]
}
```

#### kb-get-point
获取知识点详情。

**参数**:
- `point_id`: 知识点ID

#### kb-get-knowledge
获取文章详情。

**参数**:
- `knowledge_id`: 文章ID
- `include_points`: 是否包含知识点列表（默认 false）

## 使用示例

### 导入 PDF 文档

```
1. 用户: 帮我把财务手册.pdf导入到财务知识库
2. 专家调用: kb-import-file(file_path="财务手册.pdf", kb_id=1)
3. 自动调用: kb-embed(kb_id=1)  # 异步生成向量
```

### 语义检索

```
1. 用户: 报销流程是怎样的？
2. 专家调用: kb-search-vector(query="报销流程", kb_id=1)
3. 专家调用: kb-get-point(point_id=返回的第一个)
4. 返回答案
```