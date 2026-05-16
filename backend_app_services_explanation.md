# `app/services` 目录说明

目标目录：

- `D:\System\Desktop\MyGitHub\MyGitHub\app\services`

说明范围：

- 以下内容基于该目录下的 `.py` 源文件整理
- `__pycache__` 为 Python 编译缓存，可忽略

## 整体分工

- `auth`：工具权限校验
- `harness`：运行时基础设施，负责上下文压缩、错误处理、护栏、可观测性、工具集管理
- `langgraph`：Agent 主流程编排
- `llm`：统一封装大模型调用
- `mcp`：把各种能力注册成工具
- `rag`：知识库文档导入、切分、向量检索、网页抓取

## `auth`

### `tool_authz.py`

工具级权限服务。核心是 `ToolAuthorizationService`，在工具执行前判断当前用户能不能调用某个工具，还会根据 `kb_id`、`principal_group_id` 之类参数推断目标 group。

### `__init__.py`

对外导出权限相关类和默认实例，方便别处直接 `import`。

## `harness`

### `context_manager.py`

上下文管理器，解决对话太长导致模型退化的问题。支持工具输出截断、滑动窗口保留最近历史等压缩策略。

### `error_handler.py`

工具执行错误处理。把错误分成瞬时错误、LLM 可恢复错误、用户可修复错误、未知错误，并决定是否重试。

### `guardrail.py`

三层护栏。检查用户输入、模型输出、工具调用是否安全或合规，比如注入攻击、PII、危险工具操作等。

### `observability.py`

运行链路观测。记录 step trace、token 使用、耗时等，方便排查和监控。

### `toolkit.py`

动态工具集管理。根据 agent 配置决定给模型暴露哪些工具、如何组织工具元数据。

### `__init__.py`

包导出文件。

## `langgraph`

### `graph.py`

核心执行图。定义 `retrieve -> setup -> llm -> tools -> finalize` 这些节点，以及整条 ReAct 风格 agent 流程。

### `orchestrator.py`

图运行入口。`AgentOrchestrator` 负责启动 agent chat、流式输出等。

### `state.py`

整套运行时状态定义。包括 agent 配置、运行模式、消息结构、token 统计、trace、最终结果。

### `__init__.py`

包导出。

## `langgraph/helpers`

### `config_helpers.py`

解析 agent 配置，比如工具白名单、KB 列表。

### `diagram_handler.py`

处理画图类工具的输出，并把结果拼进回复。

### `multi_source_formatter.py`

把多个知识源或检索结果格式化成可注入 prompt 的上下文。

### `realtime_detector.py`

判断用户问题是否需要实时数据或联网工具。

### `time_utils.py`

处理“当前时间”相关问题，生成时间提示词和快捷回复。

### `tool_categorizer.py`

给工具分类、排序，影响工具调用优先级。

### `__init__.py`

包导出。

## `langgraph/nodes`

### `llm_node.py`

执行一轮 LLM 调用，决定是否让模型调用工具。

### `planner_node.py`

规划模式判断，决定问题是否需要先做计划再执行。

### `synthesize_node.py`

汇总多个工具结果，生成可给模型或用户的综合文本。

### `verifier_node.py`

结果校验器，检查输出是否符合规则、是否需要更高验证等级。

### `__init__.py`

包导出。

## `langgraph/routers`

### `conditional_edges.py`

根据当前 state 决定下一步走哪条边，比如检索后是继续 LLM、走工具还是直接结束。

## `llm`

### `openai_compat.py`

统一的大模型适配层。负责解析 API Key、Base URL、远程模型名，并提供：

- embedding
- 普通 chat
- 流式 chat
- 带 tools 的 chat
- 带 tools 的流式 chat

本质上是把不同 OpenAI 兼容接口包装成统一调用方式。

### `__init__.py`

包导出。

## `mcp`

### `registry.py`

工具注册中心，集中保存所有 MCP 工具定义。

### `types.py`

MCP 工具基础类型。定义 `ToolContext`、`MCPTool`，负责参数校验和工具调用包装。

### `tools_authz.py`

权限管理类工具，比如查权限、查看我的权限、替换 group 权限。

### `tools_kb.py`

知识库工具，主要是 KB 搜索和文档导入。

### `tools_search.py`

网页搜索工具，封装 SerpAPI / DuckDuckGo 搜索。

### `tools_amap.py`

高德地图工具，做地理编码、逆地理编码、地点搜索、路线规划。

### `tools_diagram.py`

图表或图示生成工具，支持 `flowchart`、`sequence`、`mindmap`、`gantt`、`pie`、`state` 等。

### `tools_tianditu_bus.py`

天地图公交工具，查公交路线、线路详情、返程线路等。

### `__init__.py`

初始化并注册全部内置 MCP 工具。

## `rag`

### `chunker.py`

把长文本切成带重叠的 chunk，供后续 embedding 和检索。

### `loader.py`

读取上传文件内容，目前支持 `txt`、`md`、`pdf`，统一转成纯文本。

### `ingest.py`

知识库入库流程。把文档提取文本后切块、做 embedding、写入 `KBDocument` 和 `KBChunk`。

### `retrieve.py`

向量检索。把 query 做 embedding 后，用 `pgvector` 在 KB chunk 里查最相似片段。

### `web_scraper.py`

网页抓取器。抓单页或递归抓取站内相关页面，再转成可写入知识库的文档格式。

### `__init__.py`

对外导出 `ingest_uploaded_document` 和 `query_chunks`。

## 调用关系概览

可以把这一层理解成：

1. `langgraph` 负责整体 agent 流程编排
2. `llm` 负责真正调用模型
3. `mcp` 负责把外部能力和内部能力封装成工具
4. `auth` 负责工具权限校验
5. `harness` 负责运行时保护和治理
6. `rag` 负责知识库相关的数据处理与检索

一条典型链路通常是：

`用户请求 -> langgraph 编排 -> llm 决策/调用工具 -> mcp 工具执行 -> auth/harness 控制 -> rag 或其他服务返回结果 -> langgraph 汇总输出`
