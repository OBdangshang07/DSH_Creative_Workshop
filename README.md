# DSH Creative Workshop

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 插件生态的“创意工坊”式发现、评估、组合与安装平台。

> 当前仓库包含一个可离线运行、可验证的 MVP：目录控制平面、本机 Companion 和简易浏览器前端。示例插件是固定测试数据，不代表真实发布或安全背书。

## 可运行 MVP

当前实现包括：

- 规范化插件、不可变版本、权限、兼容性、证据、关系、合集和版本评价领域模型；
- JSON Schema 清单校验器；
- 复合文本/标签/OS/Surface/风险检索及可解释排序；
- 插件—依赖—Service—Slot—Route 关系投影；
- 固定版本和顺序的合集解析；
- 安装回执加权、Wilson 置信下界和版本绑定评价 API；
- 仅监听 loopback 的 Companion：环境探测、受控计划、确认令牌、幂等 dry-run 操作和本机回执；
- React/Vite 简易前端：目录、筛选、详情、权限、评价、关系图、合集和安装计划。

Companion **不会接受任意 argv、命令、脚本或路径**。当前公开执行器有意固定为 `dry-run`，不会改动现有 `$DSH_HOME`；真实 `dsh plugin` 事务、快照和回滚仍属于后续阶段。

## 本地运行

要求 Node.js 22.19+ 和 Corepack：

```powershell
corepack pnpm install
corepack pnpm check
corepack pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:5173`
- Marketplace API：`http://127.0.0.1:4100`
- Local Companion：`http://127.0.0.1:4101`

启动 Companion 时会在终端打印随机 `Local token`。将它填入插件详情的安装计划区域即可。token 只保存在浏览器 `sessionStorage`；也可以在开发环境设置 `WORKSHOP_COMPANION_TOKEN` 使用固定值。

单独运行：

```powershell
corepack pnpm dev:api
corepack pnpm dev:companion
corepack pnpm dev:web
corepack pnpm validate:manifest
```

完整实现说明见[当前 MVP 实现](docs/11-implementation.md)。

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
| [当前 MVP 实现](docs/11-implementation.md) | 代码结构、运行方式、安全边界与后续缺口 |
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
- 不复刻 Valve/Steam 的视觉资产或商标；当前网页只提供用于验证业务闭环的简易界面。

## 项目状态

`Runnable MVP / Dry-run Companion`。目录、检索、图、合集、评价、计划和简易前端已可运行；真实 DSH 写入事务仍未启用。

本项目是独立的社区规划项目，与 DeepSeek 官方无隶属或背书关系；“STEAM 创意工坊”仅描述产品交互范式，项目不使用 Valve/Steam 的商标、素材或页面设计。

## License

[MIT](LICENSE)
