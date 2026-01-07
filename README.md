# MyGitHub_front

基于现有后端 `MyGitHub`（FastAPI）搭建的前端项目：**Vue 3 + Vite + TypeScript + NPM + Tailwind CSS**。

## 快速开始

1) 安装依赖

```bash
cd MyGitHub_front
npm install
```

2) 配置后端地址（可选）

复制 `.env.example` 为 `.env.local` 并修改：

```bash
VITE_API_BASE_URL=http://127.0.0.1:9000
```

3) 启动开发服务器

```bash
npm run dev
```

默认 Vite 端口为 `http://localhost:5173`。

## 页面入口

- 前台（占位）：`/`
- 登录：`/auth/login`
- 注册：`/auth/register`
- 后台（用户管理）：`/admin/users`
- 后台（分组管理/树）：`/admin/groups`
- 邮箱验证（邮件链接）：`/verify-email?token=...`

右上角下拉可切换「前台/后台」。

## 开发命令

- `npm run dev`：开发
- `npm run build`：构建（含 `vue-tsc` 类型检查）
- `npm run preview`：本地预览构建产物
- `npm run lint`：ESLint
- `npm run format`：Prettier（含 Tailwind class 排序）

## 文档

更详细的后端接口对接与页面说明见：`MyGitHub_front/docs/指导文档.md`。

