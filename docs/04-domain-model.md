# 领域与数据模型

## 1. 核心实体

### Plugin

逻辑产品身份，不随版本改变。

关键字段：

- `pluginId`：工坊稳定 UUID；
- `slug`：人类可读标识；
- `kind`：`bundle | cordis-plugin | skill-pack | mcp-bundle | integration | collection | ecosystem-tool`；
- `publisherId`；
- `canonicalSourceId`；
- `status`：candidate/published/suspended/retired；
- `replacementPluginId`；
- `createdAt/updatedAt`。

只有 `bundle` 和经明确适配的 `cordis-plugin` 进入一键安装。其他类型仍可被发现，但安装动作和风险提示不同。

### PluginVersion

不可变版本快照。若同一 semver 对应内容哈希改变，创建异常事件而不是覆盖。

关键字段：

- `pluginVersionId`；
- `version`；
- `sourceRef`、`sourceCommit`、`artifactDigest`；
- `packageName`、`packageSubdir`、`packageManagerSpec`；
- `dshManifest`、`workshopManifest`；
- `compatibility`、`capabilities`、`permissions`；
- `publishedAt`、`yankedAt`。

### Source

记录 GitHub、npm、作者 feed 或人工录入来源。`SourceObservation` 保存每次抓取的原始响应哈希、时间和解析状态。

### Publisher

用户或组织。GitHub 登录只能证明控制某账号；package scope、域名或组织身份需独立验证。

### Evidence

不可变验证记录：

- subject：插件版本；
- producer：worker、组织、维护者或用户 Companion；
- level：L0-L5；
- environment；
- checks 与结果；
- artifact/log digest；
- startedAt/completedAt/expiresAt；
- verdict：pass/warn/fail/inconclusive。

### Review

绑定 `pluginVersionId`，并可附 DSH/environment。包含评分维度、结构化兼容结果、文本、receipt proof 和作者回应。编辑创建 revision，不静默改历史。

### Tag

受控词汇节点，包含 namespace、canonical name、别名、父子关系和互斥组。自由标签保存在 suggestion 中，经治理后映射。

### DependencyEdge

版本化的有向关系：

```text
from PluginVersion
  -- kind / constraint / scope / optional / order / source -->
to Package | Plugin | Capability | Slot | Service | Route | Namespace
```

`source` 必须区分：package manifest、bundle patch、workshop manifest、静态推断、运行观测或人工声明。

### Collection / CollectionRelease

Collection 是合集身份；CollectionRelease 是不可变发布：成员、版本约束、目标 profile、层序、可选项、冲突策略和 lock snapshot。

### InstallationReceipt

默认只存在本机：

- intent/plan id；
- profile 和环境摘要；
- 安装前文件哈希与依赖快照；
- 每一步命令类别与退出结果；
- 解析出的版本与 artifact digest；
- dump-config diff；
- Loader/功能验收；
- rollback 信息。

上传社区时只发送用户审阅后的最小证明。

## 2. 插件标准元数据

工坊不替换 `package.json.dsh`，只增加可选 `workshop` 文档。权威优先级：

1. artifact 实际内容与 digest；
2. `package.json` 和 bundle patch；
3. 作者签名的 workshop manifest；
4. 验证器推断；
5. 社区建议。

manifest 核心域：

- identity/source；
- summary/useCases/audience；
- install units 与目标平面；
- DSH/Node/OS/arch compatibility；
- permissions 与 lifecycle scripts；
- capability、service、slot、route、namespace；
- dependency/conflict/replacement；
- preview assets；
- smoke test 与 health check；
- support/security policy。

JSON Schema 见 [`spec/workshop-manifest.schema.json`](../spec/workshop-manifest.schema.json)。

## 3. 关系类型

| 关系 | 含义 | 是否影响安装 |
|---|---|---|
| `requires` | 必须满足 | 是，阻断 |
| `optional` | 可选增强 | 否，用户选择 |
| `peer` | 需由环境提供兼容版本 | 是 |
| `provides-service` | 提供 Cordis service | 是，供依赖求解 |
| `injects-service` | 硬依赖 service | 是 |
| `registers-slot` | 向 Client slot 注册 | 可能冲突 |
| `claims-seat` | 占用单席位/fallback | 是，冲突 |
| `registers-route` | 注册 Host route | 可能冲突 |
| `overrides-entry` | 通过 patch id 覆盖行 | 是，顺序敏感 |
| `conflicts` | 明确不可共存 | 是 |
| `replaces` | 新插件/版本替代旧项 | 升级提示 |
| `extends` | 组合增强，不是依赖 | 搜索/推荐 |
| `member-of` | 属于合集 | 合集求解 |
| `verified-with` | 某环境通过验证 | 兼容选择 |

## 4. 标签本体

建议 namespace：

- `function/*`：search、memory、vision、workflow、ui-theme、terminal 等；
- `plane/*`：host、agent、client、external；
- `surface/*`：web、headless、tui、desktop；
- `integration/*`：github、browser、obsidian、telegram 等；
- `io/*`：image-input、audio-output、filesystem-write 等；
- `permission/*`：network、process、workspace-write、credentials；
- `platform/*`：windows、linux、macos、arm64；
- `maturity/*`：experimental、preview、stable、deprecated；
- `evidence/*`：manifest-only、build-pass、runtime-pass、manual-review；
- `audience/*`：beginner、developer、enterprise、research；
- `cost/*`：free、api-key、paid-service、local-model。

标签字段要区分 `declared`、`derived`、`verified`。例如作者声明支持 Windows，不等于验证器已经在 Windows 跑通。

## 5. 兼容性模型

兼容不是布尔值，至少包含：

- DSH semver range；
- 已验证 DSH commit；
- Node/pnpm；
- OS/arch；
- profile/surface；
- 必需 feature/capability；
- 不兼容的已知 commit/range；
- evidence freshness。

版本选择器优先使用 runtime evidence；没有证据时可以返回“可尝试”，但不能显示为“已兼容”。

## 6. 综合排序数据

为避免黑箱，保留各原始特征：

- query relevance；
- verified compatibility；
- environment fit；
- review Wilson score；
- unique successful receipts；
- maintenance freshness；
- publisher trust；
- risk penalty；
- report severity；
- popularity（低权重）；
- personalization（可关闭）。

最终排名响应同时返回 top reasons 和 exclusions，方便未来 UI 解释。
