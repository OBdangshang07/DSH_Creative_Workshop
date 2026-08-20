# 当前 v1.2.0 实现

## 1. 范围

本实现把规划中的高价值闭环落成一个模块化 TypeScript monorepo：用户可从浏览器发现和比较插件，查看标准化权限、证据、评价与关系，选择精确版本，并向本机 Companion 请求一个可审阅的安装计划。当前操作执行到可审计的 dry-run 回执为止，不修改真实 DSH profile。

生产目录通过 `dsh-plugin`、`deepseek-harness`、`dsh-bundle` Topic 与仓库名称/描述检索发现候选，并支持用户提交精确 GitHub URL。API 固定仓库 commit，分类验证标准 `dsh.bundle.patch` Bundle、可安装的本地 Bundle、成对 Preset 和 Git submodule Suite；新 revision 仍必须经管理员人工审核后才能公开。结构验证不代表官方认证或安全审计。

## 2. 代码结构

```text
apps/
  api/          Marketplace HTTP API（默认 127.0.0.1:4100）
  companion/    本机探测、计划和 dry-run 操作（默认 127.0.0.1:4101）
assets/         生产商店视觉资源
js/             无构建依赖的生产浏览器模块
login/          独立登录/注册页面
admin/          独立管理控制台
packages/
  domain/       领域类型和风险规则
  manifest/     JSON Schema/Ajv 清单校验
  catalog/      Repository 接口、种子数据、搜索、图、合集和评价聚合
```

当前生产账号与目录数据层使用 Node.js 内置 SQLite、WAL、外键约束和迁移表。首次部署会将旧 `/var/lib/dsh-workshop/data.json` 导入 `workshop.sqlite`，并保留 `.pre-sqlite-backup` 原始备份。演示领域包中的 `InMemoryCatalogRepository` 仍供早期协议测试使用，不再是生产目录事实来源。

## 3. Marketplace API

当前生产核心接口：

```text
GET  /health
GET  /v1/plugins
GET  /v1/plugins/:id
GET  /v1/plugins/:id/cover.svg
GET  /v1/plugins/:id/media/:index
GET  /v1/plugins/:id/related
POST /v1/plugins/:id/media/report
GET  /v1/plugins/:id/revisions
GET  /v1/plugins/:id/revisions/:revisionId
GET  /v1/plugins/:id/reviews
POST /v1/plugins/:id/reviews
GET  /v1/presence/summary
POST /v1/presence/heartbeat
POST /v1/presence/leave
GET  /v1/discussions
POST /v1/discussions
GET  /v1/discussions/:id
POST /v1/discussions/:id/replies
POST /v1/reports
GET  /v1/collections
GET  /v1/collections/:id
POST /v1/collections/:id/clone
GET  /v1/me/plugin-submissions
POST /v1/me/plugin-submissions
GET  /v1/reviews
GET  /v1/activity
GET  /v1/releases
POST /v1/auth/register
POST /v1/auth/login
GET  /v1/me/sessions
GET  /v1/me/profile
PATCH /v1/me/profile
GET  /v1/me/favorites
GET  /v1/me/subscriptions
GET  /v1/me/plugins/:id/state
POST /v1/me/favorites/:id/toggle
POST /v1/me/subscriptions/:id/toggle
GET  /v1/me/collections
POST /v1/me/collections
PATCH /v1/me/collections/:id
DELETE /v1/me/collections/:id
GET  /v1/me/notifications
POST /v1/me/notifications/read
GET  /v1/me/notification-preferences
PATCH /v1/me/notification-preferences
GET  /v1/me/saved-searches
POST /v1/me/saved-searches
PUT  /v1/me/discussions/:id/subscription
GET  /v1/admin/overview
GET  /v1/admin/plugins
PATCH /v1/admin/plugins/:id
GET  /v1/admin/media
POST /v1/admin/plugins/:id/media/retry
GET  /v1/admin/media-reports
PATCH /v1/admin/media-reports/:id
GET  /v1/admin/plugin-submissions
PATCH /v1/admin/plugin-submissions/:id
PATCH /v1/admin/plugins/:id/revisions/:revisionId/changelog
POST /v1/admin/plugins/:id/revisions/:revisionId/changelog/retry
POST /v1/admin/sync-runs
GET  /v1/admin/sync-runs/:id
GET  /v1/admin/users
GET  /v1/admin/community
GET  /v1/admin/reports
PATCH /v1/admin/reports/:id
GET  /v1/admin/audit
```

公开目录支持名称、描述、包名搜索，以及 kind、surface、topic、author、language、license 分面、排序和分页。管理端额外支持审核状态、用户角色/状态、社区内容状态、举报状态、审计操作和分页。社区评价要求登录，并由服务端绑定当前公开 Revision；同一用户对同一 Revision 只保留一条最新评价。收藏、订阅、合集和评价都只能引用当前公开插件。

在线人数定义为过去 90 秒内有前台活动的浏览器：同一 Cookie 的多个标签页只计一次，Bot/Headless 客户端不计入，原始标识仅保存在进程内存中。SQLite 只保留五分钟聚合桶，用于管理端 24 小时峰值。讨论正文与回复只按纯文本输出；游客可读，登录用户可发帖、回复、关注和举报。合集默认私有，只有用户明确公开且未被管理员隐藏时才进入合集广场。用户可分别控制插件、讨论、合集和平台版本通知。

插件 Revision 更新日志按插件结构化声明、GitHub Release、仓库 CHANGELOG、Commit 摘要的顺序采集，并保存来源、固定 Commit 范围和发布快照。没有可信内容时明确显示“作者未提供更新日志”。平台版本使用 `releases/v<version>.json` 作为结构化发布来源。

GitHub 目录同步同时覆盖最近更新与高 Star 的 Topic 结果，并在验证前读取核心 API 余额。未配置专用 Token 时每批最多处理 15 个仓库，其余标记为延后；管理端“继续同步”仅处理所选任务的失败与延后仓库。候选仓库数、验证仓库数、Bundle 数、待审核 Revision 和公开插件数分别统计，不再混用。

生产环境可通过 systemd 已声明的 `/etc/dsh-workshop/api.env` 提供 `GITHUB_TOKEN`。应使用仅用于公开仓库读取、没有仓库写入和工作流权限的专用凭据，并将文件权限设为 `0600`；服务未读取到 Token 时会明确报告匿名模式，而不是静默冒充完整同步能力。

## 4. Local Companion

Companion 固定以下安全边界：

- `server.ts` 拒绝非 loopback host；
- Host 只接受 loopback 地址，Origin 使用显式 allowlist；
- 所有 mutation 要求 `Bearer` 本机 token；
- 只接受 `pluginVersionId`、profile、plan id 和确认 token 等结构化字段；
- 显式拒绝 `argv`、`command`、`script` 和 `path`；
- profile 名称采用 allowlist，并验证解析路径不能越过 profiles 根目录；
- 环境探测只运行代码内固定的 `dsh --version` 和 `corepack pnpm --version`；
- Plan 固定 catalog revision、profile digest、package spec、source commit 和 artifact digest；
- Operation 要求 8–128 字符的 `Idempotency-Key`，相同 key 返回同一结果；
- 计划确认 token 使用一次后失效；
- 计划查询不会再次返回一次性确认 token；
- 当前执行模式永久标记为 `dry-run`，回执明确 `rollbackAvailable: false`，因为没有发生本机写入。

Companion 核心接口：

```text
GET  /health
GET  /v1/environment
GET  /v1/profiles
POST /v1/plans
GET  /v1/plans/:id
POST /v1/operations
GET  /v1/operations/:id
GET  /v1/operations/:id/events
```

## 5. 浏览器前端

- `/`：保留既有商店视觉与布局，卡片只映射经过验证并审核通过的真实 Bundle。
- `/plugin/?id=...`：站内插件二级详情，展示标准字段、固定 Commit 证据、声明依赖、动态社区数据和明确的 GitHub 外链。
- `/?view=discussions` 与 `/discussion/?id=...`：真实讨论列表、发帖、回复、删除、举报与刷新可恢复详情。
- `/collections/` 与 `/collection/?id=...`：公开合集广场、详情、复制和举报。
- `/?view=reviews` 与 `/?view=activity`：全站评价，以及可按平台、插件、讨论、合集筛选并展开更新日志的动态。
- `/login/`：独立登录/注册、字段级错误、密码强度、提交状态和仅站内的 `returnTo`。
- `/admin/`：独立管理控制台，包含实时在线/24h 峰值、目录治理统计、revision 证据、异步同步任务与候选失败原因、用户/Session 管理、社区内容/举报治理和带请求上下文的审计日志。

普通用户中心提供账号名修改、通知偏好、保存搜索、收藏/订阅列表、合集创建/编辑/删除、设备 Session 撤销和修改密码。首页、详情和用户中心不再保留“仅弹出成功提示”的模拟操作。

## 6. 验证

```powershell
corepack pnpm validate:manifest
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

自动化测试覆盖清单、风险、组合搜索、撤回过滤、图投影、合集顺序/隐私/复制、Revision 评价迁移、在线去重/过期/Bot 过滤、讨论权限/锁定/举报、通知幂等、社区治理、API 合同、稳定错误码、环境解析、Companion token/Origin、命令字段拒绝、profile traversal、依赖计划、幂等操作和 dry-run 回执；Playwright 额外覆盖卡片到详情、社区路由刷新、登录回跳、讨论/回复、公开合集、管理治理、真实筛选和 390px 移动端布局。

## 7. 尚未实现

以下内容没有被 dry-run 冒充为已完成：

- npm 独立采集、作者 claim 与所有权验证；
- OAuth、邮箱验证、找回密码和治理申诉；
- 隔离的代码级安全分析和动态沙箱；
- 大规模目录需要的独立搜索服务与对象存储；
- 隔离的 L3/L4 verification worker；
- 真实 `dsh plugin` adapter；
- profile 文件事务日志、锁、快照、故障恢复、健康检查和真实回滚；
- 生产级 Companion pairing/系统托盘分发与签名更新；
- macOS/Linux/Windows 的真实 DSH 安装矩阵。

真实执行器启用前必须完成文件事务、profile 漂移检查、受限生命周期脚本、崩溃恢复和跨平台测试，不能仅把 dry-run adapter 换成 `exec`。
