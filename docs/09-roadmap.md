# 实施路线图

## 0. 当前阶段：架构与规范基线

交付：

- 上游实现调研；
- 产品边界和领域词汇；
- 目标架构、安全模型和安装事务；
- manifest/API 草案；
- 可评审的阶段与验收标准。

退出条件：产品、DSH 集成、安全和数据负责人对关键决策无未决分歧。

## 1. Phase 1：只读生态目录

### 工作包

- GitHub topic 与作者提交 ingestion；
- 仓库/package/bundle locator；
- manifest/patch/license/readme 静态解析；
- PostgreSQL catalog 与版本模型；
- 基础搜索、分面与版本详情 API；
- Verification L0-L2；
- 管理员 quarantine/publish/yank。

### 验收

- 同一仓库多个安装单元可正确区分；
- 已删除 `.dsh-plugin` 协议只作为 legacy 风险，不被视为当前可安装格式；
- 每个字段能追到来源；
- DSH/package 版本变化不覆盖旧记录；
- denylist 在搜索索引延迟时仍立即生效。

## 2. Phase 2：图与可复现合集

### 工作包

- package、bundle patch、service/slot/route 图提取；
- 受控标签本体和别名治理；
- graph queries 与冲突解释；
- collection authoring 与 immutable release；
- lock snapshot 和总权限摘要；
- 规则型、可解释推荐。

### 验收

- 能解释一个 bundle 的全部直接/传递影响；
- 冲突 edge 带来源，不依赖手写黑名单；
- 同一 collection release 在相同环境解析出相同 lock；
- 依赖循环、顺序不确定和可选替代有明确错误。

## 3. Phase 3：本机 Companion 与一键安装

### 工作包

- loopback pairing 和本机确认；
- DSH environment/profile probe；
- Plan/Resolver/Policy；
- profile transaction journal 与 receipt；
- DSH CLI adapter；
- restart/reload orchestration；
- dump-config、inventory、smoke verification；
- rollback 和崩溃恢复。

### 验收

- 所有 mutation 都由 Plan 驱动且幂等；
- 云端无法传任意命令；
- profile 漂移会阻断而非覆盖；
- 模拟每个步骤崩溃后都能恢复或明确报告人工修复；
- Windows/Linux/macOS 代表环境完成 bundle 安装、升级、卸载、回滚；
- 高风险脚本未确认时绝不执行。

## 4. Phase 4：社区评价与兼容回执

### 工作包

- GitHub OAuth 与 publisher claim；
- 版本绑定的结构化 review；
- 可选 receipt-backed success/failure；
- 聚合、时间衰减和置信区间；
- 作者回应、举报、申诉和审核；
- 反滥用检测。

### 验收

- 评价无法脱离版本发布；
- 作者/协作者评价不进入普通分母；
- 严重安全事件不会被大众好评抵消；
- 所有 moderation 动作可审计；
- 用户可预览并拒绝上传本机证据。

## 5. Phase 5：运行验证与上游内嵌

### 工作包

- 隔离 Worker L3/L4；
- DSH commit matrix 与证据过期；
- 可选 DSH bundle，在 `settings.plugins.tab` 注册入口；
- Host/Agent/Client health probes；
- 上游 API 适配层与兼容测试。

### 验收

- Worker 无控制平面凭据且默认无出网；
- 每条“运行通过”都展示精确环境和测试范围；
- DSH 上游变更能触发受影响插件重新验证；
- 内嵌 bundle 卸载后不影响外部 Companion 和 catalog。

## 6. UI 阶段

界面规则已写入 [UI 设计项目规划](11-ui-design-plan.md)。UI 不重新发明业务含义，只投影下列稳定输入：

- 页面所需标准字段；
- install operation 状态机；
- 评价维度与证据等级；
- 搜索 filter 与 explain response；
- 依赖图 node/edge 类型；
- 风险确认升级规则；
- collection release 模型。

后续 UI 工作按该文档第 14 节：结构终稿 → 中保真六页 → 高保真与组件库 → 静态数据可点原型。原型不接 `dsh plugin`，也不阻塞 Phase 1–5 的工程工作。

## 7. 测试策略

### Contract

- JSON Schema fixtures；
- API consumer/provider contract；
- catalog revision 和 event idempotency。

### Resolver

- property-based dependency graphs；
- version/peer/OS/arch matrices；
- layer ordering、cycle、alternative、optional；
- service/slot/route conflicts。

### Companion

- fake DSH CLI 与真实 rc.5 smoke；
- 文件故障注入、进程中断、并发修改；
- Windows junction/path quoting；
- loopback CSRF/DNS rebinding；
- rollback equivalence。

### Verification

- 恶意 package fixtures；
- network/process/resource escape tests；
- artifact digest/provenance；
- secret scanning 和 log sanitization。

### End-to-end

- 单 bundle 安装；
- 多成员合集；
- 构建脚本审批；
- Client half 加载；
- Agent preset 生效；
- 兼容失败与自动回滚；
- 版本撤回后的本机提示。

## 8. 主要风险与缓解

| 风险 | 缓解 |
|---|---|
| DSH 协议快速变化 | Adapter 层、commit-bound evidence、上游契约测试 |
| 社区元数据不标准 | 渐进清单、推断带 provenance、精选与全量分层 |
| 一键安装风险过大 | Plan/confirm/transaction/rollback，危险步骤升级交互 |
| 扫描被误解为安全 | 证据分层、限定文案、人工安全通道 |
| 图模型过早复杂化 | PostgreSQL 真源、派生投影、从高价值 edge 起步 |
| Companion 被网页滥用 | loopback pairing、origin/host 校验、本机确认、无任意 argv |
| 评价刷量 | receipt proof、置信区间、反滥用、作者隔离 |

## 9. 推荐团队切分

- Catalog/Ingestion；
- Resolver/Graph；
- Companion/DSH Adapter；
- Verification/Security；
- Community/Governance；
- Product/UI（界面规则见 11；线框/原型与 Phase 1 可并行）。

MVP 可由同一后端团队维护模块化单体，但 Verification 和 Companion 的安全责任必须有明确 owner。
