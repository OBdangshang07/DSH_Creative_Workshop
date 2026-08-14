# 当前 MVP 实现

## 1. 范围

本实现把规划中的高价值闭环落成一个模块化 TypeScript monorepo：用户可从浏览器发现和比较插件，查看标准化权限、证据、评价与关系，选择精确版本，并向本机 Companion 请求一个可审阅的安装计划。当前操作执行到可审计的 dry-run 回执为止，不修改真实 DSH profile。

生产目录通过 GitHub `dsh-plugin` Topic 发现候选，但 Topic 本身不构成收录资格。API 固定仓库 commit，扫描 monorepo 中的 `package.json`，验证 `dsh.bundle.patch`、Cordis entry 结构和 DSH/Cordis 依赖证据；新 revision 必须经管理员人工审核后才能公开。结构验证仍不代表官方认证或安全审计。

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
GET  /v1/plugins/:id/reviews
POST /v1/plugins/:id/reviews
POST /v1/auth/register
POST /v1/auth/login
GET  /v1/me/sessions
GET  /v1/me/favorites
GET  /v1/me/subscriptions
GET  /v1/me/plugins/:id/state
POST /v1/me/favorites/:id/toggle
POST /v1/me/subscriptions/:id/toggle
GET  /v1/me/collections
POST /v1/me/collections
PATCH /v1/me/collections/:id
DELETE /v1/me/collections/:id
GET  /v1/admin/overview
GET  /v1/admin/plugins
PATCH /v1/admin/plugins/:id
POST /v1/admin/sync-runs
GET  /v1/admin/sync-runs/:id
GET  /v1/admin/users
GET  /v1/admin/audit
```

公开目录支持名称、描述、包名搜索，以及 kind、surface、topic、author、language、license 分面、排序和分页。管理端额外支持审核状态、用户角色/状态、审计操作和分页。社区评价要求登录，并由服务端绑定当前公开 Revision；同一用户对同一 Revision 只保留一条最新评价。收藏、订阅、合集和评价都只能引用当前公开插件。

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
- `/login/`：独立登录/注册、字段级错误、密码强度、提交状态和仅站内的 `returnTo`。
- `/admin/`：独立管理控制台，包含目录治理统计、revision 证据、异步同步任务与候选失败原因、用户/Session 管理和带请求上下文的审计日志。

普通用户中心提供收藏/订阅列表、合集创建/编辑/删除、当前插件加入合集、设备 Session 撤销和修改密码。首页、详情和用户中心不再保留“仅弹出成功提示”的模拟操作。

## 6. 验证

```powershell
corepack pnpm validate:manifest
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

自动化测试覆盖清单、风险、组合搜索、撤回过滤、图投影、合集顺序、Revision 评价迁移、API 合同、稳定错误码、环境解析、Companion token/Origin、命令字段拒绝、profile traversal、依赖计划、幂等操作和 dry-run 回执；Playwright 额外覆盖卡片到详情、刷新/后退、登录回跳、用户持久化操作、真实筛选和移动端布局。

## 7. 尚未实现

以下内容没有被 dry-run 冒充为已完成：

- npm 独立采集、作者 claim 与所有权验证；
- OAuth、邮箱验证、找回密码、举报和申诉；
- 隔离的代码级安全分析和动态沙箱；
- 大规模目录需要的独立搜索服务与对象存储；
- 隔离的 L3/L4 verification worker；
- 真实 `dsh plugin` adapter；
- profile 文件事务日志、锁、快照、故障恢复、健康检查和真实回滚；
- 生产级 Companion pairing/系统托盘分发与签名更新；
- macOS/Linux/Windows 的真实 DSH 安装矩阵。

真实执行器启用前必须完成文件事务、profile 漂移检查、受限生命周期脚本、崩溃恢复和跨平台测试，不能仅把 dry-run adapter 换成 `exec`。
