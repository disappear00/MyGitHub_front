# AI 对话平台（Models / Knowledge Bases / Agents）前端改造计划（MyGitHub_front）

> 目标：基于后端 `MyGitHub` 已新增的 AI 对话平台模块接口，在 `MyGitHub_front` 增加“模型/知识库/Agent 管理 + Agent 对话”能力，并与现有登录、邮箱验证、权限体系一致集成。

## 0. 背景与约束

- 后端统一响应：`{ code, message, data }`（成功 `code=200`）
- 鉴权：`Authorization: Bearer <access_token>`（前端已在 `src/lib/http.ts` 做 token + refresh）
- 访问约束：除 `/api/v1/auth/*` 外，大多数 `/api/v1/*` 依赖“已登录 + 邮箱已验证”（前端路由守卫已有 `requiresVerified`）

## 1. 新增功能范围（前端）

### 1.1 AI 资源管理（后台 Admin）

1. **AI 模型 Models**

- 列表 / 创建 / 编辑 / 删除
- 支持字段：`name/provider/model_kind/base_url/credential_ref/description/config/is_private/group_id`
- 可选：提供一个“连通性测试/对话测试”（对接 `POST /api/v1/models/{id}/chat`，支持 `stream=true` 的 SSE）

2. **知识库 Knowledge Bases**

- 列表 / 创建 / 编辑 / 删除
- 文档管理：文档列表、上传导入（`POST /documents`）
- 检索调试：输入 query，返回命中 chunk（`POST /query`）

3. **Agents**

- 列表 / 创建 / 编辑 / 删除
- Agent 配置：`system_prompt/model_id/config/is_private/group_id`
- **对话入口在前台**：前台提供对话页（选择 Model/Agent/KB），后台仅负责资源管理与权限控制

### 1.2 权限与可见性

- 前端按路由维度做基础权限门禁（与现有 Admin 逻辑一致）：
  - Models：`models.read/models.create/models.update/models.delete`
  - Knowledge Bases：`knowledge_bases.read/knowledge_bases.create/knowledge_bases.update/knowledge_bases.delete`
  - Agents：`agents.read/agents.create/agents.update/agents.delete`
- 说明：后端对“分组裁剪/私有资源”在 CRUD 层已做二次校验，前端仅做 UI 门禁与提示，不做安全假设。

## 2. 后端接口对接清单（/api/v1）

> 下列接口均使用 `ApiResponse<T>` 包装，前端统一用 `src/lib/api.ts` 的 `unwrap/unwrapVoid` 处理。

### 2.1 Models（`/api/v1/models`）

- `GET /api/v1/models`：列表
- `POST /api/v1/models`：创建（body：`AIModelCreate`）
- `GET /api/v1/models/{model_id}`：详情
- `PUT /api/v1/models/{model_id}`：更新（body：`AIModelUpdate`）
- `DELETE /api/v1/models/{model_id}`：删除
- `POST /api/v1/models/{model_id}/chat?stream={bool}`：模型对话测试
  - body：`{ messages: [{ role, content, ... }] }`
  - `stream=false`：返回 `data: { content: string }`
  - `stream=true`：SSE：`data: <delta>\n\n`，结束 `data: [DONE]\n\n`

### 2.2 Knowledge Bases（`/api/v1/knowledge-bases`）

- `GET /api/v1/knowledge-bases`：列表
- `POST /api/v1/knowledge-bases`：创建（body：`KnowledgeBaseCreate`）
- `GET /api/v1/knowledge-bases/{kb_id}`：详情
- `PUT /api/v1/knowledge-bases/{kb_id}`：更新（body：`KnowledgeBaseUpdate`）
- `DELETE /api/v1/knowledge-bases/{kb_id}`：删除
- `GET /api/v1/knowledge-bases/{kb_id}/documents`：文档列表
- `POST /api/v1/knowledge-bases/{kb_id}/documents`：上传/导入（`multipart/form-data`，字段名 `file`）
- `POST /api/v1/knowledge-bases/{kb_id}/query`：检索调试（body：`{ query: string, top_k?: number }`）

### 2.3 Agents（`/api/v1/agents`）

- `GET /api/v1/agents`：列表
- `POST /api/v1/agents`：创建（body：`AgentCreate`）
- `GET /api/v1/agents/{agent_id}`：详情
- `PUT /api/v1/agents/{agent_id}`：更新（body：`AgentUpdate`）
- `DELETE /api/v1/agents/{agent_id}`：删除
- `POST /api/v1/agents/{agent_id}/chat`：发起/续聊
  - body：`{ conversation_id?: number, messages: [{role:'user',content:string}], kb_ids?: number[], rag_top_k?: number, max_tool_rounds?: number, max_history_messages?: number }`
  - resp：`{ conversation_id: number, content: string, meta: object }`

## 3. 前端路由与页面规划

### 3.1 路由（建议）

在现有 `AdminShell` 下新增 AI 模块入口（管理端）：

- `/admin/ai/models`：模型列表（含新建/编辑弹窗或详情页）
- `/admin/ai/knowledge-bases`：知识库列表
- `/admin/ai/knowledge-bases/:kbId`：知识库详情（文档列表 + 上传 + 检索调试）
- `/admin/ai/agents`：Agent 列表

前台对话入口：

- `/chat`：对话页（可选择 模型/智能体/知识库；对话记录在本地保存会话列表，Agent 模式使用 `conversation_id` 续聊）

路由 `meta` 规则：

- 全部：`requiresAuth: true`、`requiresVerified: true`、`requiredPermissions: [...]`
- “对话页”至少要求 `agents.read`（更严格可改为：若后端未来引入 `agents.run` 权限，则前端对应新增门禁）

### 3.2 页面组件拆分（建议）

- `src/pages/admin/ai/AdminAIModelsPage.vue`
- `src/pages/admin/ai/AdminKnowledgeBasesPage.vue`
- `src/pages/admin/ai/AdminKnowledgeBaseDetailPage.vue`
- `src/pages/admin/ai/AdminAgentsPage.vue`
- `src/pages/admin/ai/AdminAgentChatPage.vue`

通用组件（可复用）：

- `JsonEditor`（基于 `<textarea>`：支持格式化/校验 JSON）
- `ConfirmDialog` / `Drawer` / `Modal`（沿用现有风格）
- `EmptyState`、`Loading`、`Toast`（如项目已有则复用，否则在改造期补齐最小版本）

## 4. 数据层改造（src/lib）

### 4.1 Types（`src/lib/types.ts`）

新增类型：

- `AIModelResponse/AIModelCreate/AIModelUpdate`
- `KnowledgeBaseResponse/KnowledgeBaseCreate/KnowledgeBaseUpdate`
- `KBDocumentResponse/IngestResponse/KBQueryRequest/KBQueryResponse`
- `AgentResponse/AgentCreate/AgentUpdate`
- `AgentChatRequest/AgentChatResponse`

### 4.2 API 封装（`src/lib/api.ts`）

新增模块：

- `aiModelApi`：CRUD + `chatTest`（可选 SSE）
- `knowledgeBaseApi`：CRUD + `listDocuments/uploadDocument/query`
- `agentApi`：CRUD + `chat`

文件上传注意事项：

- 使用 `FormData`，字段名必须为 `file`
- 让 `http` 自动设置 `Content-Type`（不要手动写 boundary）

## 5. 交付拆分（Milestones）

### Milestone A：对齐接口与基础页面骨架

- 增加路由与导航入口（AdminShell 增加“AI 对话平台”分组）
- 补齐 `types.ts` 与 `api.ts` 的 AI 相关封装
- 先用最小表格/表单跑通 Models/KB/Agents 列表与 CRUD

### Milestone B：知识库文档与检索调试

- 知识库详情页：文档列表、上传导入
- 检索调试：展示命中 chunk（内容/score/meta）并支持复制

### Milestone C：Agent 对话体验

- Agent 对话页：多轮对话 + 续聊（持久化 `conversation_id` 到路由 query 或本地存储）
- 可选：显示 `meta`（工具调用/检索命中）用于调试

### Milestone D：可选增强

- Model SSE 对话测试（`stream=true`）：逐字输出体验
- UI 体验打磨：分页/搜索/排序、错误提示统一化、表单校验完善

## 6. 验收标准（建议）

- 使用同一套登录/邮箱验证/权限守卫，未验证邮箱无法进入 AI 管理页
- Models/KB/Agents 三类资源的 CRUD 均可在页面完成并正确提示错误
- KB 文档上传成功后，能在文档列表看到新增记录；检索调试能返回 hits
- Agent 对话：首次对话返回 `conversation_id`，后续带上 `conversation_id` 可连续对话
