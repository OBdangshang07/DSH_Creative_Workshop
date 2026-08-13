# 安装与生命周期

## 1. “一键安装”的状态机

```text
DRAFT
  -> RESOLVING
  -> READY_FOR_CONFIRMATION
  -> APPLYING
  -> RESTARTING_OR_RELOADING
  -> VERIFYING
  -> COMMITTED
                    \-> ROLLING_BACK -> ROLLED_BACK
  any pre-apply step \-> BLOCKED / CANCELLED
```

每次 transition 写入本机事务日志。客户端重连后通过 operation id 继续观察，不重复执行。

## 2. Plan 阶段

Planner 输入：

- 用户选择的 plugin/collection release；
- 目标 profile/preset；
- 本机 DSH/Node/pnpm/OS/arch；
- profile manifest、lockfile、patch 与 dump-config；
- 当前 Loader inventory；
- 用户风险策略和已授权权限；
- 固定 catalog revision。

输出：

- 精确 source spec、resolved ref 和 artifact digest；
- 将新增/更新/删除的依赖；
- bundle 层序变化；
- patch/entry/config 影响；
- service/slot/route/namespace 冲突；
- 新权限、凭据、构建脚本与网络访问；
- 生效方式：热应用、刷新、进程重启或新会话；
- 验证步骤和回滚策略。

Plan 是纯函数产物，必须可序列化、可审阅、可缓存。执行器不得临时决定另一个版本。

## 3. 解析与依赖求解

### 3.1 约束来源

- npm dependencies/peerDependencies/engines；
- `dsh.bundle.patch` 指向的 patch；
- patch 中的 entry id、module specifier、inject、disabled、config；
- `dsh.client.inject`；
- workshop manifest 的 capability/conflict/order；
- 当前 profile 的实际组合；
- collection lock。

### 3.2 冲突规则

阻断级：

- 同一 Cordis service 的互斥 provider 同时挂载；
- 同一单席位 slot/fallback/route 被重复占用；
- peer/engine 不满足；
- bundle patch 对关键 entry 形成未知顺序覆盖；
- 安装来源无法锁定；
- denylist 中的 artifact digest；
- 插件要求当前策略禁止的生命周期脚本。

警告级：

- 可选依赖缺失；
- 只有过期验证证据；
- 版本声明兼容但没有运行验证；
- 评价显示某平台失败率上升；
- plugin 会替换已有能力但有明确选择器。

### 3.3 层序

bundle 顺序是配置语义，不按字母排序。合集必须显式给出偏序约束；Resolver 做拓扑排序。多个合法排序时使用稳定规则并写进 lock，避免下一次安装漂移。

## 4. Apply 阶段

### 4.1 安装前快照

在执行任何副作用前保存：

- profile `package.json`、workspace 配置、lockfile、patch 文件内容和哈希；
- `dsh.profile.bundles`；
- `dsh --dump-config` 输出哈希；
- 当前运行进程与 Loader inventory；
- 相关本机设置的最小快照。

不会复制用户会话或凭据内容；必要时只保存元数据/引用。

### 4.2 执行适配器

Bundle 的基本路径：

```text
dsh plugin --profile <profile> add <locked-spec>
```

升级和卸载使用相应 pnpm verb，但由 Adapter 生成，不允许远程传 argv。执行后重新读取 manifest 和 lockfile，确保解析结果符合 Plan。

普通、无 `dsh.bundle` 的 Cordis 包不应在 MVP 自动插入 patch，除非其 workshop manifest 给出经过验证的 entry id/config 模板，且用户明确安装到目标平面。默认只把它标为“需要手动组合”。

### 4.3 构建脚本

若 pnpm 要求 `allowBuilds`：

1. Plan 列出精确包名、版本、脚本和来源；
2. 用户单独确认；
3. Companion 只写该精确键，不放宽全局策略；
4. 构建在受限环境执行并记录输出；
5. 后续更新出现新脚本时重新确认。

## 5. 生效策略

| 变化 | 默认生效方式 |
|---|---|
| profile 用户 patch config | 依赖 DSH 配置 HMR；失败保持最后可用树 |
| 新增/移除 bundle 层 | 进程重启后重新组合 |
| Host Node half 代码 | 重启 |
| Client bundle | 页面刷新；开发 HMR 不是生产安装保证 |
| Agent preset | 新会话或明确重载目标 session |
| settings namespace 值 | 由拥有方决定，可能下一次操作生效 |

工坊不承诺所有插件“无重启安装”。一个按钮可以包含受控重启和会话恢复，但必须在 Plan 里说明。

## 6. Verify 阶段

最低验收：

1. pnpm 操作成功；
2. manifest/lockfile 与 Plan 一致；
3. `dsh --dump-config` 可解析且预期 entries 存在；
4. DSH 可启动；
5. 目标 entry `ACTIVE`，没有新增 `FAILED/PENDING`；
6. 插件声明的 health check 或 smoke test 通过；
7. Client half 存在时，boot graph 包含目标 bundle；
8. 事务期间没有越权文件变化。

健康检查必须是声明式、超时受限的已知动作，不能让远程 manifest 注入任意 shell。

## 7. Commit 与 Receipt

验收成功后：

- 标记 transaction committed；
- 保存解析版本、digest、变更 diff、验证结果；
- 将 collection lock 或 plugin lock 写入 Companion 数据库；
- 可选向云端上传匿名成功证据；
- 提供“一键撤销本次安装”的 receipt 引用。

## 8. Rollback

失败时按反向顺序：

1. 停止新进程或撤销 HMR 变化；
2. 恢复 profile manifest、patch、workspace 配置和 lockfile；
3. 执行一次受控 `pnpm install --frozen-lockfile` 恢复依赖树；
4. 重启原 profile；
5. 比对原 dump-config 与 Loader inventory；
6. 保留失败日志并标记是否完全恢复。

如果 plugin 的 lifecycle 脚本写了 profile 目录之外的内容，自动回滚不能保证清理，必须在安装前风险提示中明确。这也是为何安装第三方包不能被称为强沙箱。

## 9. 并发与幂等

- 一个 profile 同时只允许一个 mutation transaction；
- lock 包含进程、时间、operation id 和心跳，崩溃后可恢复；
- 相同 idempotency key 返回同一 operation；
- Plan 使用的文件哈希在 Apply 前再次比较，漂移则回到 resolving；
- 用户在另一个终端修改 profile 时，不覆盖其变更。

## 10. 更新与卸载

升级先计算旧→新权限、依赖、entry 和证据差异。新增权限、扩大版本范围或更换 publisher/source 必须重新确认。

卸载必须区分：

- 禁用：保留依赖和配置；
- 从 profile 移除：删除 bundle/依赖但保留用户数据；
- 完全清理：仅删除 manifest 明确声明且位于允许目录的 owned data；
- 回滚到上一版本：复用历史 receipt 与 lock。

任何不确定归属的数据都保留并报告，不能猜测删除。
