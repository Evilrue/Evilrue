# evilrue-chat

Cloudflare Worker + Durable Object 的实时聊天室：一个网址，任何网络的人都能进同一个房间聊天。

- 网页由 Worker 直接返回，消息走 WebSocket
- 每个房间一个 Durable Object 实例，负责广播、在线人数、最近 200 条历史
- 前端全部在 `public/index.html`，`build.mjs` 把它内联进 `dist/worker.js`

## 部署

- 有 Git 自动构建：Build command 填 `node build.mjs`，Deploy command 填 `npx wrangler deploy`
- 本地部署：`npx wrangler deploy`

## 结构

```
src/worker.js       Worker + Durable Object
public/index.html   前端（样式 + 逻辑）
build.mjs           生成 dist/worker.js
wrangler.toml       Worker 名称、DO 绑定、SQLite 迁移
dist/worker.js      构建产物（可直接粘贴进面板）
```
