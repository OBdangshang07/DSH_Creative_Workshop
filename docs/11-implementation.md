# 当前 MVP 实现

## 1. 范围

本实现把规划中的高价值闭环落成一个模块化 TypeScript monorepo：用户可从浏览器发现和比较插件，查看标准化权限、证据、评价与关系，选择精确版本，并向本机 Companion 请求一个可审阅的安装计划。当前操作执行到可审计的 dry-run 回执为止，不修改真实 DSH profile。

固定示例数据用于离线演示和自动化测试。它们不从网络动态抓取，也不是对任何真实插件的发布、验证或安全背书。

## 2. 代码结构

```text
apps/
  api/          Marketplace HTTP API（默认 127.0.0.1:4100）
  companion/    本机探测、计划和 dry-run 操作（默认 127.0.0.1:4101）
  web/          React/Vite 简易前端（默认 127.0.0.1:5173）
packages/
  domain/       领域类型和风险规则
  manifest/     JSON Schema/Ajv 清单校验
  catalog/      Repository 接口、种子数据、搜索、图、合集和评价聚合
```

MVP 的 `InMemoryCatalogRepository` 是 PostgreSQL repository 的替换点。搜索与图投影是纯领域服务，未来可换为 PostgreSQL FTS/OpenSearch 和持久化图投影，而不改变网页或 Companion 的领域协议。

## 3. Marketplace API

实现的核心接口：

```text
GET  /health
GET  /v1/catalog
GET  /v1/plugins
GET  /v1/plugins/:id
GET  /v1/plugins/:id/versions
GET  /v1/plugin-versions/:id
GET  /v1/plugin-versions/:id/evidence
GET  /v1/plugins/:id/graph
GET  /v1/collections
GET  /v1/collections/:id
GET  /v1/plugin-versions/:id/reviews
POST /v1/plugin-versions/:id/reviews
POST /v1/resolve
```

搜索可组合 `q`、`tags`、`kind`、`os`、`surface`、`maxRisk` 和 `sort`。响应带 `catalogRevision`；命中项包含选择版本、匹配原因、风险和警告。

公开评价写入绑定精确 `pluginVersionId`，要求五个 1–5 分维度。客户端不能自行声称安装回执，因此公开写入始终是 `receiptBacked: false`。聚合时回执评价权重更高，并提供 Wilson 置信下界。完整的身份、审核和反滥用仍是后续工作。

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

## 5. 简易前端

网页用于验证信息和交互闭环，而不是最终 UI 稿。它提供：

- 搜索、受控标签、风险上限和可信度/评分/时间排序；
- 插件卡片和标准化版本、评分、权限域摘要；
- 详情抽屉中的权限、兼容性、证据、动态评价与 SVG 关系图；
- 固定版本、角色与安装顺序的合集页面；
- Companion 在线检测；
- profile 与会话级 token 输入；
- 一键生成计划、审阅变更并确认 dry-run 回执。

## 6. 验证

```powershell
corepack pnpm validate:manifest
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

自动化测试覆盖清单、风险、组合搜索、撤回过滤、图投影、合集顺序、评价权重、API 合同、稳定错误码、环境解析、Companion token/Origin、命令字段拒绝、profile traversal、依赖计划、幂等操作和 dry-run 回执。

## 7. 尚未实现

以下内容没有被 dry-run 冒充为已完成：

- GitHub/npm ingestion、作者 claim 和真实插件审核；
- PostgreSQL、对象存储、搜索集群和持久化事件；
- OAuth、moderation、举报、申诉和完整反滥用；
- 隔离的 L3/L4 verification worker；
- 真实 `dsh plugin` adapter；
- profile 文件事务日志、锁、快照、故障恢复、健康检查和真实回滚；
- 生产级 Companion pairing/系统托盘分发与签名更新；
- macOS/Linux/Windows 的真实 DSH 安装矩阵。

真实执行器启用前必须完成文件事务、profile 漂移检查、受限生命周期脚本、崩溃恢复和跨平台测试，不能仅把 dry-run adapter 换成 `exec`。
