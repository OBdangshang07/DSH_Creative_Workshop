# 发现、评价与图检索

## 1. 发现管线

```text
Discover candidate
 -> Fetch source snapshot
 -> Locate installable units
 -> Parse manifests and patches
 -> Normalize identity/version
 -> Validate
 -> Classify
 -> Publish candidate or quarantine
```

### 候选来源

- GitHub topic 是高召回、低精度入口；
- 作者提交是高意图入口；
- 人工精选 feed 是高精度入口；
- npm 搜索只作为补充；
- fork/mirror 通过 provenance 关系合并，不能简单去重仓库名。

### 可安装单元定位

一个仓库可包含多个 package。Locator 检查 workspace、根/子目录 package、`dsh.bundle`、Cordis entry、`dsh.client` 和明确的作者 manifest。每个单元独立版本化与验证。

## 2. 标准化与质量门槛

进入候选目录的最低要求：

- 公开可读取或来自已授权私有源；
- 可锁定 commit/tag/artifact；
- 包名和入口合法；
- 有许可证或明确标记 `license-unknown`；
- 安装/卸载说明存在；
- 权限和生命周期脚本可枚举；
- DSH 兼容声明或至少已验证基线；
- 不命中已知恶意 digest/source。

缺字段可以进入 quarantine 或“生态资源”，不能伪装为一键可安装。

## 3. 动态评价体系

### 3.1 原始信号分离

| 信号 | 示例 | 可信度 |
|---|---|---|
| Verified runtime | Worker 在固定环境加载并 smoke test | 高，但范围有限 |
| Receipt-backed report | 用户本机成功/失败且附 receipt proof | 中高 |
| Structured review | 易用性、文档、性能、稳定性分项 | 中 |
| Maintainer response | 已修复、无法复现、替代方案 | 上下文信号 |
| Popularity | GitHub star、收藏、安装计数 | 低，易受偏差 |
| Security report | CVE、恶意行为、泄露、撤回 | 高优先级独立通道 |

### 3.2 评价维度

- `worksAsDescribed`；
- `installationEase`；
- `documentation`；
- `stability`；
- `performanceImpact`；
- `permissionClarity`；
- `supportResponsiveness`。

安全性不由大众星级投票。安全风险来自权限事实、扫描、报告和人工审核。

### 3.3 聚合方法

- 好评率使用带先验的 Wilson/Beta 区间，避免 1 个五星压过 100 个四星；
- 同一账号、设备证明和版本的重复权重受限；
- receipt-backed review 权重高于未验证评论；
- 评价随版本和 DSH 基线衰减；
- 新版本继承插件级历史但不继承旧版本兼容分；
- 严重安全事件作为独立 penalty/deny，不被好评抵消；
- 所有聚合提供分母、时间窗和置信区间。

### 3.4 防滥用

- GitHub 账号年龄、组织归属和行为图用于限流，不直接做公开声誉分；
- 检测互评环、短时突增、同源设备和模板评论；
- 作者/协作者评价明确标记，不进入普通分母；
- 删除只对违规内容，评分修订保留 audit revision；
- 插件作者可以回应和申诉，不能隐藏有效失败证据。

## 4. 搜索模型

### 4.1 Query 输入

- 关键词/自然语言意图；
- 功能、平台、surface、权限、成本、成熟度；
- 当前 DSH environment；
- 已安装插件与目标 profile；
- 必须/排除的关系；
- 排序偏好：相关、可信、近期、流行、低风险。

### 4.2 Query 处理

1. 意图解析为文本与结构化 filters；
2. 全文/向量召回候选；
3. 用版本选择器选出当前环境可用版本；
4. 图扩展依赖、替代和合集；
5. Policy 排除恶意、不可锁定或组织禁用项；
6. 重排并生成解释。

### 4.3 排名解释

每个结果返回：

- `selectedVersion` 与选择理由；
- `matchReasons`，例如“Windows + Web + image-input”；
- `compatibilityEvidence`；
- `riskSummary`；
- `whyNotHigher` 或关键缺失证据；
- `alternatives`。

## 5. 图检索用例

支持的查询示例：

- “这个插件安装后还会带来哪些 bundle？”
- “谁提供它 inject 的 `workspace` service？”
- “哪些插件会占用相同设置 slot？”
- “找一个能替代 A、兼容 Windows、无网络权限的插件。”
- “这个合集为何不能与当前 profile 共存？”
- “哪些已装插件会被升级 B 影响？”
- “从 vision 到 browser automation 的最小依赖路径是什么？”

## 6. 合集

合集分两类：

- **Curated Collection**：用于发现，可含松散版本范围；
- **Reproducible Collection Release**：用于安装，必须有 lock、层序和兼容证据。

合集发布要求：

- 明确目标 DSH 基线/profile/surface；
- 成员角色（required/optional/alternative）；
- 版本约束与 digest；
- 总权限摘要；
- 已知冲突和顺序；
- 合集级 smoke test；
- 维护者和更新时间。

合集评分不简单平均成员评分。它重点评价“组合后是否工作”和“维护者是否及时更新 lock”。

## 7. 推荐系统边界

MVP 只做可解释的规则与内容推荐：相似功能、常一起安装、合集成员、依赖补全。个性化默认基于本地或明确同意上传的数据，可关闭、可清空。不基于会话内容做隐式画像。
