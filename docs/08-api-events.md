# API 与事件草案

## 1. API 设计原则

- 所有资源 id 为不透明字符串；
- 所有读取响应带 `catalogRevision`；
- mutation 使用 `Idempotency-Key`；
- 异步操作返回 Operation，不长时间占用请求；
- 错误包含稳定 code、用户可读 message 和 machine details；
- 安装 API 分为云端 intent 与本机 execution，不能混为一个远程命令。

## 2. Marketplace API

### Catalog

```http
GET /v1/plugins?q=&tags=&platform=&dsh=&sort=&cursor=
GET /v1/plugins/{pluginId}
GET /v1/plugins/{pluginId}/versions
GET /v1/plugin-versions/{pluginVersionId}
GET /v1/plugin-versions/{pluginVersionId}/evidence
GET /v1/plugin-versions/{pluginVersionId}/graph?depth=2
POST /v1/resolve
```

`POST /v1/resolve` 输入环境与选择，返回候选版本和服务器可见约束；它不替代 Companion 的本机最终计划。

### Collection

```http
GET  /v1/collections
POST /v1/collections
GET  /v1/collections/{collectionId}
POST /v1/collections/{collectionId}/releases
POST /v1/collection-releases/{releaseId}/resolve
```

### Community

```http
GET  /v1/plugin-versions/{id}/reviews
POST /v1/plugin-versions/{id}/reviews
POST /v1/reviews/{id}/revisions
POST /v1/reviews/{id}/reactions
POST /v1/plugin-versions/{id}/reports
POST /v1/reviews/{id}/author-response
```

### Publisher

```http
POST /v1/submissions
GET  /v1/submissions/{id}
POST /v1/plugins/{id}/claim
POST /v1/plugin-versions/{id}/reverify
```

## 3. Install Intent

云端创建的 intent 只包含不可变选择和展示摘要：

```json
{
  "intentId": "ii_...",
  "catalogRevision": "cr_...",
  "target": { "type": "profile", "suggestedName": "web" },
  "selections": [
    {
      "pluginVersionId": "pv_...",
      "sourceCommit": "...",
      "artifactDigest": "sha256:..."
    }
  ],
  "expiresAt": "2026-08-14T12:00:00Z",
  "signature": "..."
}
```

Companion 必须重新校验签名、digest、denylist 和本机约束。

## 4. Companion API

绑定 `127.0.0.1`，仅配对 origin 可访问。

```http
POST /v1/pair/challenge
POST /v1/pair/complete
GET  /v1/environment
GET  /v1/profiles
POST /v1/plans
GET  /v1/plans/{planId}
POST /v1/operations
GET  /v1/operations/{operationId}
GET  /v1/operations/{operationId}/events
POST /v1/operations/{operationId}/cancel
POST /v1/receipts/{receiptId}/rollback
```

创建 operation 的请求只能引用已确认 plan：

```json
{
  "planId": "plan_...",
  "confirmationToken": "local-one-time-token"
}
```

## 5. Plan 响应

```json
{
  "planId": "plan_...",
  "state": "READY_FOR_CONFIRMATION",
  "target": { "profile": "web" },
  "lockedInputs": {
    "catalogRevision": "cr_...",
    "profileDigest": "sha256:...",
    "dshVersion": "0.1.0-rc.5"
  },
  "changes": [],
  "permissionsAdded": [],
  "conflicts": [],
  "warnings": [],
  "activation": { "requiresRestart": true, "requiresNewSession": false },
  "verification": [],
  "rollback": { "supported": true, "limitations": [] }
}
```

## 6. Operation 事件

事件 envelope：

```json
{
  "eventId": "evt_...",
  "operationId": "op_...",
  "sequence": 12,
  "type": "operation.step.completed",
  "at": "2026-08-14T10:20:30Z",
  "data": {}
}
```

核心事件：

- `operation.created`；
- `operation.state.changed`；
- `operation.step.started/completed/failed`；
- `operation.user-action-required`；
- `operation.log.appended`；
- `operation.rollback.started/completed/failed`；
- `operation.committed`。

日志事件只带安全摘要；完整日志通过受保护的本机 endpoint 按需读取。

## 7. 领域事件

云端内部事件：

- `source.observed`；
- `plugin.unit.discovered`；
- `plugin.version.published/yanked`；
- `verification.requested/completed`；
- `evidence.expired`；
- `review.created/revised`；
- `security.report.triaged`；
- `catalog.revision.published`；
- `collection.release.published/degraded`。

消费者必须幂等；事件至少一次投递，顺序只在同一 aggregate 内保证。

## 8. 错误码

建议前缀：

- `CATALOG_*`：资源、版本、revision；
- `COMPAT_*`：环境与版本不兼容；
- `RESOLVE_*`：依赖/层序/冲突；
- `POLICY_*`：风险或组织策略阻断；
- `PROFILE_*`：本机状态、漂移、锁；
- `DSH_*`：CLI/Loader/activation；
- `VERIFY_*`：健康检查；
- `ROLLBACK_*`：恢复不完整；
- `PAIRING_*`：Companion 授权。

错误不得只返回上游 stderr；应保存原始日志并映射稳定 code。

## 9. 版本策略

外部 HTTP API 使用 `/v1`；schema 中增加字段保持向后兼容。Companion 与云端在握手时交换 protocol range。DSH Adapter 是内部版本化接口，按上游 DSH 基线实现多个适配器，不把 DSH Developer Preview 的变化泄漏给市场 API。
