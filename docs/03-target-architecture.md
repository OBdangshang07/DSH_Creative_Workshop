# 目标系统架构

## 1. 总体原则

- **云端负责知识与协作，本机负责执行。**
- **工坊拥有意图与证据，DSH 拥有运行状态。**
- **任何安装都先生成计划，再产生副作用。**
- **所有结论都能追到来源、版本、环境和时间。**

## 2. 逻辑组件

```text
Public Sources / Author Submissions
          |
          v
  Ingestion & Normalization -----> Artifact/Object Store
          |                               |
          v                               v
 Catalog DB <---- Verification ---- Evidence DB
    |   |             Workers              |
    |   +------> Search Index <-------------+
    |                  |
    +------> Graph Projection
          |
          v
 Marketplace API <---- Auth / Community / Moderation
          |
       HTTPS (read/catalog/intent)
          |
          v
 Local Companion ----> Planner / Resolver ----> DSH Adapter
       |                       |                    |
       |                       v                    v
       +---- Receipt Store  Transaction        dsh plugin / pnpm
                              Journal           profile files / Loader
```

## 3. 云端控制平面

### 3.1 Ingestion

连接器按来源独立运行：

- GitHub topic `dsh-plugin`；
- 经审核的 catalog feed；
- 作者手动提交；
- npm metadata；
- 未来的企业/私有源。

采集只创建 `SourceObservation`，不会立即宣布“这是插件”。Normalizer 再判断仓库内可安装单元、子目录、包名、版本和类型。

### 3.2 Catalog Service

Catalog 保存规范化实体和不可变版本记录，提供：

- 插件/版本读取；
- 兼容版本选择；
- 标签与分类；
- 依赖/冲突/合集；
- 作者归属和命名空间验证；
- 下架、撤回和替代关系。

PostgreSQL 作为规范真相。搜索索引和图投影均可从它重建。

### 3.3 Verification Workers

验证分层执行：

- L0：来源与仓库存在；
- L1：manifest/package/patch 解析；
- L2：依赖、扩展点和兼容静态分析；
- L3：可复现构建；
- L4：隔离 profile 加载与最小功能测试；
- L5：人工安全审查或可信组织签名。

每次任务固定：插件 ref、DSH ref、Node/pnpm、OS、架构、网络策略和测试脚本哈希。输出为不可变 Evidence，不直接覆盖旧结论。

### 3.4 Search 与 Graph

搜索引擎承担全文、分面、排序和向量召回；图投影承担多跳关系。初期可用 PostgreSQL + OpenSearch，关系稳定后再评估图数据库。

图不是第二真源。每条 edge 带 `derivedFrom` 和 `validForVersionRange`，可以从 Catalog 重算。

### 3.5 Community 与 Moderation

社区服务拥有评价、评论、反应、报告、作者回应和合集协作。它不修改验证证据，只能产生独立的社区信号。

Moderation 记录所有动作、理由和申诉。高风险撤回可以立即影响推荐和安装许可，但原始版本页与审计记录保留。

## 4. 本机 Companion

### 4.1 为什么需要本机进程

浏览器网站不能安全地：

- 读写 `$DSH_HOME/profiles/*`；
- 调用 `dsh plugin` / pnpm；
- 读取真实 DSH/Node/OS 环境；
- 观察 Loader 激活状态；
- 可靠完成重启和回滚。

Companion 是用户主动安装和运行的 loopback 服务或 DSH Host plugin，只绑定 `127.0.0.1`，使用一次性配对令牌和严格 Origin allowlist。远程页面不得直接传任意 shell 命令。

### 4.2 Companion 子模块

| 模块 | 职责 |
|---|---|
| Environment Probe | DSH 版本/commit、Node/pnpm、OS/arch、profiles、当前运行状态 |
| Catalog Client | 只读取已签名 catalog snapshot 与 install intent |
| Planner | 将用户意图解析成版本、依赖、层序、权限和变更集 |
| Policy Engine | 应用风险偏好、来源信任、组织策略和离线策略 |
| DSH Adapter | 生成并调用允许列表内的 `dsh plugin` 操作，读取 dump-config/inventory |
| Transaction Manager | 快照、锁、执行、验证、提交、回滚 |
| Receipt Store | 本机保存计划、来源、日志摘要、变更前后哈希和验收结果 |

### 4.3 Companion API 安全

- 只接受结构化操作：`plan/install/upgrade/uninstall/rollback/status`；
- 不接受客户端提供的 argv、路径或脚本；
- install intent 必须带 catalog 版本与不可变 artifact/ref；
- mutation 请求需幂等键、短期配对 token 和用户在本机确认；
- 日志默认本地保存，上传前脱敏并由用户确认；
- 禁止绑定 `0.0.0.0`；不依赖 CORS 作为唯一防线。

## 5. DSH 集成方式

### Phase A：外部 Companion

优先使用外部进程调用官方 CLI：

- `dsh --version`；
- `dsh --profile <name> --dump-config`；
- `dsh plugin --profile <name> add/remove/update ...`；
- 读取 profile `package.json`、lockfile 和 patch 的哈希；
- 启动后读取现有 plugin inventory Remote 或执行健康探针。

这样不需要 fork DSH，且能适应其 Developer Preview 的快速变化。

### Phase B：可选 DSH 管理插件

当上游接口稳定后，可提供一个 bundle，为 Web 设置的 `settings.plugins.tab` 注册“工坊”入口，并暴露严格的本机管理 Remote。该 bundle 只是 Adapter，不拥有 catalog 或安装状态。

### 禁止的耦合

- 直接 import DSH 私有实现并把内部类型当长期协议；
- 从网页修改 `cordis.patch.yml` 文本；
- 用工坊数据库推断某个插件当前 ACTIVE；
- 把动态 Cordis 临时包当持久安装机制；
- 恢复上游已移除的 repository cache。

## 6. 数据存储建议

| 数据 | 存储 | 理由 |
|---|---|---|
| Catalog/Community/Policy | PostgreSQL | 强一致关系、审计、事务 |
| 搜索文档 | OpenSearch | 全文、分面、排序、聚合 |
| 图投影 | PostgreSQL 起步，后续 Neo4j 可选 | 先减少运维复杂度 |
| Manifest/报告/日志工件 | S3 兼容对象存储 | 内容寻址与长期保留 |
| 队列 | PostgreSQL queue 或 NATS | 验证任务与事件解耦 |
| Companion receipts | 本地 SQLite | 离线、事务、可审计 |

## 7. 一致性模型

- Catalog 写入成功后异步更新搜索与图投影；API 返回 `catalogRevision`。
- 安装计划固定一个 `catalogRevision`，执行期间不追随最新版本。
- 评价聚合最终一致，但原始评价写入强一致。
- 风险撤回是强优先级事件：搜索和安装 Policy 先读 denylist，再读最终一致索引。
- Companion 以 profile 文件与 CLI 结果为权威；云端“已安装”只作为用户同步的可选镜像。

## 8. 部署切分

MVP 可采用模块化单体：Catalog、Community、Search API 与 Admin 在一个服务内，Verifier 和 Ingestion 为独立 worker。不要在需求稳定前拆成大量微服务。

真正需要独立扩缩容和隔离的是执行不受信任代码的 Verification Worker；它必须与控制平面账号、网络和密钥彻底分离。
