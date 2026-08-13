# 架构决策记录

## ADR-001：采用独立控制平面，不 fork DSH

**决定**：目录、社区、搜索和验证作为独立服务；通过 Adapter 与 DSH 交互。

**理由**：上游处于 Developer Preview；插件运行时已经成熟地拥有 Loader/Profile 真相，市场能力不应侵入 Agent Loop 或复制生命周期。

## ADR-002：云端不直接执行本机安装

**决定**：云端生成签名 install intent，本机 Companion 重新解析、确认和执行。

**理由**：浏览器没有合理权限读写 profile 或调用 pnpm；本机环境才是最终约束来源。

## ADR-003：只采用 profile bundle 作为默认一键安装单元

**决定**：MVP 对声明 `dsh.bundle.patch` 的包提供完整一键安装；纯 Cordis 包默认只发现，除非有经过验证的组合模板。

**理由**：上游已删除 repository 插件路径，且 `dsh plugin` 不会自动挂载 bundle-less 依赖。自动猜测 entry/config 会制造另一套协议。

## ADR-004：不把动态 Cordis 包用于市场安装

**决定**：`cordis_define/run` 仅视作进程内实验工具。

**理由**：它不持久化、sandbox 不是安全边界、重启即消失，也不会产生 profile/lockfile 安装事实。

## ADR-005：PostgreSQL 是目录真源，搜索和图为派生投影

**决定**：MVP 不把图数据库设为写入真源。

**理由**：关系需要审计、版本和事务；先降低系统复杂度，待多跳查询量证明后再拆。

## ADR-006：评价绑定版本与环境

**决定**：不提供脱离版本的永久星级。

**理由**：DSH 和插件都快速变化，兼容评价只有在明确版本/环境下才有意义。

## ADR-007：安全信号与大众评分分离

**决定**：综合发现分可降权风险，但不允许好评抵消 deny/yank/security advisory。

**理由**：安全不是受欢迎程度。

## ADR-008：一键是事务，不是零确认

**决定**：普通变更一次确认；危险权限、生命周期脚本、来源变化或冲突单独升级。

**理由**：极简交互必须保留知情同意和可恢复性。

## ADR-009：合集发布是不可变 lock

**决定**：可安装 collection release 固定成员、版本、digest、层序和目标环境。

**理由**：松散收藏不能保证复现；更新应发布新 release。

## ADR-010：标准元数据是扩展，不替换 package.json.dsh

**决定**：`workshop-manifest.json` 补充市场字段，运行时 identity/entry 仍从实际 package 和 patch 解析。

**理由**：避免建立与 DSH 相竞争的插件格式；声明与实际冲突时以 artifact 为准并产生证据告警。

## 暂缓事项

- 精确前端技术栈与视觉系统；
- 私有企业 registry；
- 付费和分成；
- 全量图数据库；
- 自动迁移 agent preset；
- 通用 schema 驱动的插件设置表单；
- 无重启 bundle 动态展开；
- 强安全沙箱承诺；
- 与上游合并的正式 Plugin Management Remote。

暂缓不等于否决；只有出现明确需求、稳定上游接口和安全方案后才重新评审。
