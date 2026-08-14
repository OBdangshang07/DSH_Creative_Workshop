# DSH Creative Workshop

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 插件生态的“创意工坊”式发现、评估、组合与安装平台规划。

> 产品与工程基线见 `docs/01`–`10`。浏览器工坊、独立账号页与管理控制台已经部署；实现边界与运维说明见 [`docs/11-implementation.md`](docs/11-implementation.md)。

当前正式版本：**v1.1.2**。该版本为插件与平台更新提供可追溯的更新日志和 Revision 历史，并开放账号名修改、通知偏好、讨论关注、保存搜索及对应管理能力；发布记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前结论

DSH 已经有强大的插件运行时，但还没有一个官方中心化市场：

- Cordis 提供 Context、Service、Event、effect 与 Fiber 生命周期；DSH 的模型适配器、工具、会话、Agent Loop、Host 与 Client 功能都由插件组成。
- 外部插件的官方分发路径是可安装的 profile bundle。`dsh plugin --profile <name> ...` 只是把参数转发给 pnpm，再根据包的 `dsh.bundle.patch` 声明维护 profile 的有序 bundle 层。
- profile 是 `$DSH_HOME/profiles/<name>` 下的独立包环境；配置依次叠加 bundle、profile patch、home patch 与命令行 overlay。
- Web 端已有只读 Loader 清单和少量插件配置能力，但没有市场目录、社区评价、依赖可视化或通用安装 API。
- 官方发现入口仅是 GitHub `dsh-plugin` topic；截至调研时 GitHub 返回 417 个候选仓库，元数据质量、插件类型和兼容性差异很大。

因此，本项目的定位不是“给现有插件列表换一个皮肤”，而是在 DSH 运行时之外增加一层独立的 Marketplace Control Plane：它负责目录、标准化、证据、社区、图检索与安装编排；DSH Loader、profile manifest、lockfile 和 patch 仍是本机运行事实的唯一权威。

## 文档地图

| 文档 | 内容 |
|---|---|
| [上游架构基线](docs/01-deepseek-harness-baseline.md) | DSH 插件、profile、bundle、Host/Client 与现有限制 |
| [产品范围与原则](docs/02-product-scope.md) | 用户、核心任务、五项目标的非 UI 定义、范围边界 |
| [目标系统架构](docs/03-target-architecture.md) | 控制平面、本机代理、信任边界、数据流和部署拓扑 |
| [领域与数据模型](docs/04-domain-model.md) | 插件、版本、证据、评价、标签、依赖、合集、安装事实 |
| [安装与生命周期](docs/05-install-lifecycle.md) | 一键安装的事务模型、预检、回滚、升级和卸载 |
| [发现、评价与图检索](docs/06-discovery-reputation-search.md) | 数据采集、动态评分、防滥用、标签本体和图查询 |
| [安全、兼容性与治理](docs/07-security-governance.md) | 权限、供应链、验证等级、审核、申诉和隐私 |
| [API 与事件草案](docs/08-api-events.md) | REST/Command API、状态机、幂等与事件契约 |
| [实施路线图](docs/09-roadmap.md) | 分阶段交付、验收条件、测试策略和风险 |
| [决策记录](docs/10-decisions.md) | 已确定的架构选择与明确暂缓事项 |
| [UI 设计项目规划](docs/11-ui-design-plan.md) | 信息架构、页面、一键状态机、评价/检索/依赖图的界面规则 |
| [官方 UI 对齐与工具化](docs/12-official-ui-alignment-plan.md) | 抓取 deepseek.com/harness 与官方 Web UI，展示块改为可操作工具 |
| [插件清单规范](spec/workshop-manifest.schema.json) | 工坊扩展元数据 JSON Schema（draft v0.1） |
| [插件清单示例](examples/workshop-manifest.example.json) | 可复制的标准化元数据示例 |

## 规划基线

- 上游仓库：`deepseek-ai/deepseek-harness`
- 上游分支：`master`
- 调研提交：[`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)
- 调研日期：2026-08-14
- 上游版本：`0.1.0-rc.5`，Developer Preview，明确不承诺兼容性

规划必须按提交重新验证，不能把当前实现当作稳定 API。

## 建议的第一版成果

第一版应形成一个可用的“目录 + 本机执行器”，而不是直接追求完整社交网络：

1. 从 GitHub topic、作者提交和人工精选源采集候选。
2. 对 package、bundle patch、README、许可证、依赖和兼容声明做标准化与静态验证。
3. 提供复合检索、可信证据和依赖/合集图查询。
4. 通过本机 Companion 调用 DSH 官方 `dsh plugin` 路径，执行带预检、锁定、日志和回滚的安装事务。
5. 收集“版本 + 环境 + 结果”绑定的结构化评价，而不是脱离版本的单一星级。

详细完成定义见[实施路线图](docs/09-roadmap.md)。

## 非目标

- 不 fork 或替换 Cordis Loader。
- 不重新定义 DSH 插件格式，也不恢复已被上游删除的 `.dsh-plugin` repository 协议。
- 不让云端网站直接读写 `$DSH_HOME` 或执行 pnpm。
- 不把 GitHub star、下载量或一次静态扫描包装成“安全认证”。
- 不把 UI 规划当成可以改写安装事务、评价绑定或安全模型的许可。

## 当前实现

- 静态商店前端保持既有信息架构与视觉，目录卡片直接由 Marketplace API 的已审核数据渲染。
- 卡片进入可刷新、可分享的 `/plugin/?id=...` 站内详情；GitHub 作为详情中的明确外部按钮。
- 用户可管理真实收藏、订阅、合集、Revision 绑定评价和设备 Session；订阅不冒充本机安装。
- 用户可修改账号名、保存常用检索、控制通知类别并关注讨论；历史社区内容始终显示当前账号名，原始署名仍保留用于审计。
- 首页显示过去 90 秒内有前台活动的浏览器数量；同 Cookie 多标签页去重，自动化客户端不计入在线人数。
- 游客可读讨论、回复、公开合集、全站评价和更新动态；登录用户可发帖、回复、举报、显式公开合集并复制他人的公开合集。
- 独立 `/login/` 提供登录、注册、密码规则提示和安全站内回跳。
- 独立 `/admin/` 提供总览、在线峰值、插件 revision 审核、更新日志采集/编辑、异步 GitHub 同步、用户/Session/改名历史管理、社区治理和审计日志。
- API 使用 SQLite WAL 持久化用户、Session、目录、审核、社区关系、同步任务和审计数据，并可从旧版 JSON 自动迁移。
- GitHub `dsh-plugin` Topic 只作为候选发现源；目录固定 commit，检查 `package.json → dsh.bundle.patch → Cordis patch`，且新 revision 默认等待人工审核。

本轮没有把结构验证包装成 DeepSeek 官方认证或安全审计，也不会在服务器执行第三方 Bundle 代码。

本项目是独立的社区规划项目，与 DeepSeek 官方无隶属或背书关系；“STEAM 创意工坊”仅描述产品交互范式，项目不使用 Valve/Steam 的商标、素材或页面设计。

## License

[MIT](LICENSE)
