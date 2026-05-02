# MyGitHub_front

基于现有后端 `MyGitHub`（FastAPI）搭建的前端项目：**Vue 3 + Vite + TypeScript + NPM + Tailwind CSS**。

## 快速开始

1. 安装依赖

```bash
cd MyGitHub_front
npm install
```

2. 配置后端地址（可选）

复制 `.env.example` 为 `.env.local` 并修改：

```bash
VITE_API_BASE_URL=http://127.0.0.1:9000
```

3. 启动开发服务器

```bash
npm run dev
```

默认 Vite 端口为 `http://localhost:5173`。

## 页面入口

- 前台 AI 对话：`/`
- 登录：`/auth/login`
- 注册：`/auth/register`
- 后台（用户管理）：`/admin/users`
- 后台（分组管理/树）：`/admin/groups`
- 邮箱验证（邮件链接）：`/verify-email?token=...`

右上角下拉可切换「前台/后台」。

## 核心功能

### 1. AI 对话系统

前台核心页面，支持与 Agent 智能体进行对话交互。

#### 基础功能

- **智能体选择**：从可用 Agent 列表中选择要对话的智能体
- **知识库关联**：可选绑定知识库，启用 RAG 增强检索
- **流式输出 (SSE)**：支持实时流式显示 Agent 回复（可通过开关切换非流式模式）
- **工具调用展示**：Agent 调用 MCP 工具时，以可折叠面板显示调用参数和返回结果
- **历史对话管理**：自动保存对话记录到 localStorage，支持新建/删除/切换会话

#### 对比模式（原始 LLM vs Agent 编排）

对话页面底部提供「**对比模式（原始 vs Agent）**」开关，开启后可直观对比两种输出：

| 左侧面板 | 右侧面板 |
|---------|---------|
| 🖥 原始 LLM | 💡 Agent 编排 |
| 无 RAG / 无工具 | RAG + 工具 + 整合 |

**工作原理：**

勾选对比模式后发送消息时，前端并行发起两个独立请求：

```
用户消息
    │
    ├─ POST /api/v1/models/{id}/chat      → 纯 LLM 直接响应
    │   （无知识库、无工具、无系统增强）
    │
    └─ POST /api/v1/agents/{id}/chat?stream=true  → SSE 流式
        → RAG 检索 → 工具调用 → 多源整合 → 最终回答
```

**UI 展示特性：**

- **左右分栏对比视图**：左侧红色主题（原始 LLM），右侧绿色主题（Agent）
- **实时加载状态**：左侧在 LLM 响应完成前显示转圈动画和模型名称
- **字数统计**：每个面板标题栏显示字数
- **过短提示**：当原始 LLM 输出极短时，顶部显示说明提示条（解释这是模型无外部知识的正常表现）
- **差异摘要栏**：分栏底部量化对比（字数、倍数）

**典型场景效果：**

| 问题类型 | 原始 LLM | Agent 输出 |
|---------|---------|----------|
| 杭州旅游规划 | "以下是一些建议："（2字） | 完整 3 天行程（含景点、交通、美食） |
| 当前天气 | "我无法获取实时信息" | 通过联网搜索工具返回实时天气 |
| 知识库问答 | "我不知道" 或泛泛回答 | 从知识库检索相关片段后精准作答 |

### 2. 后台管理模块

- **智能体管理** (`/admin/ai/agents`)：创建/编辑/删除 Agent，配置模型、系统提示词、知识库、MCP 工具白名单
- **模型管理** (`/admin/ai/models`)：管理 AI 模型配置（OpenAI 兼容接口）
- **知识库管理**：上传文档、查看文档列表、语义查询
- **用户/分组/权限管理**：完整的 RBAC 权限体系

## 开发命令

- `npm run dev`：开发
- `npm run build`：构建（含 `vue-tsc` 类型检查）
- `npm run preview`：本地预览构建产物
- `npm run lint`：ESLint
- `npm run format`：Prettier（含 Tailwind class 排序）

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Vue 3.5 + TypeScript 5.9 |
| 构建 | Vite 7.2 |
| UI | Tailwind CSS 3.4 + Headless UI + Heroicons |
| HTTP | Axios |
| 状态管理 | Pinia（仅用于认证状态） |
| 路由 | Vue Router 4 |
| Markdown | marked |
| 流程图 | Vue Flow + Mermaid |

## 项目结构

```
src/
├── pages/
│   ├── front/
│   │   └── FrontChatPage.vue    # 前台对话主页（含对比模式）
│   └── admin/
│       └── ai/
│           └── AdminAgentsPage.vue  # 智能体管理
├── lib/
│   ├── api.ts                  # API 接口封装
│   ├── types.ts                # TypeScript 类型定义
│   ├── chatSessions.ts         # 对话会话数据结构 & 持久化
│   ├── sse.ts                  # SSE 流式请求工具
│   └── json.ts                 # JSON 格式化工具
├── stores/
│   └── auth.ts               # 认证状态管理
└── App.vue                       # 根组件
```

## 更详细的后端接口对接说明

见后端项目 `MyGitHub/README.md` 中第 5 章「API：路由与每个方法的作用」。
