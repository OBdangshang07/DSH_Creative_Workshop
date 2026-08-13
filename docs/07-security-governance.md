# 安全、兼容性与治理

## 1. 威胁模型

第三方 DSH 插件可以在 Host 进程中运行代码，可能访问文件、网络、进程、凭据和模型上下文。主要威胁包括：

- 恶意源码或被接管的发布账号；
- 依赖投毒、typosquat、Git ref 漂移；
- `prepare/postinstall` 生命周期脚本；
- manifest 声明与实际行为不一致；
- bundle patch 覆盖安全关键 entry；
- Client 插件窃取页面数据或伪造 UI；
- 插件更新新增权限；
- 评价刷量与兼容证据伪造；
- Companion loopback API 被恶意网页调用；
- 验证 Worker 逃逸并攻击控制平面。

## 2. 信任层级

| 层级 | 含义 | 文案限制 |
|---|---|---|
| Discovered | 找到了候选来源 | 不称为可安装 |
| Manifest Valid | 元数据和入口可解析 | 不称为兼容 |
| Static Checked | 未发现定义内阻断项 | 不称为能运行 |
| Runtime Verified | 在列明环境通过 smoke test | 不泛化到其他环境 |
| Publisher Verified | 作者/组织身份已验证 | 不等于代码安全 |
| Manually Reviewed | 指定版本经过人工审查 | 必须列范围和日期 |
| Blocked/Yanked | 已知风险或作者撤回 | 默认禁止新安装 |

不要使用没有限定词的“官方”“安全”“认证”。

## 3. 权限模型

标准权限至少覆盖：

- 文件：read/write、scope、是否越过 workspace；
- 进程：spawn、shell、PTY；
- 网络：域名、协议、listen；
- 凭据：引用哪些 credential namespace；
- 会话：读历史、写 durable event、跨 session；
- 模型：新增 tool、prompt 或 provider request；
- Client：读取 session/UI、注册 slot、外部资源；
- lifecycle：install/build/postinstall；
- 数据保留与 telemetry。

作者声明与静态/动态观测并列显示。观测到未声明行为触发高优先级警告。

## 4. 供应链控制

- 安装固定 tag/commit/tarball integrity，不执行浮动 `main`；
- 保存 artifact digest 和 provenance；
- semver 同名版本内容变化立即隔离；
- 优先验证签名 tag、npm provenance、GitHub organization ownership；
- 检测 scope 相似和拼写欺骗；
- 依赖树生成 SBOM；
- 漏洞数据库结果绑定实际解析版本；
- install Plan 明确列出所有 lifecycle scripts；
- catalog 下架不自动删除本地插件，但阻断更新并提示处置。

## 5. Verification Worker 隔离

运行构建和插件的 Worker：

- 一次性 VM/容器，任务后销毁；
- 非特权用户、只读基础镜像；
- 独立云账号/项目，无控制平面凭据；
- 默认无出网，按测试声明开放代理白名单；
- CPU/内存/磁盘/进程/时间配额；
- 不注入真实用户凭据；
- 产物与日志经恶意内容扫描后上传；
- 不把插件输出当指令；
- DSH 环境与插件 artifact 均由 digest 固定。

动态 Cordis VM sandbox 上游自己也明确不是安全边界，不能拿来执行市场中的不受信任插件。

## 6. Companion 安全

- loopback-only；
- 配对流程由本机 UI 发起，短期 token 绑定 origin；
- 防 DNS rebinding：校验 Host、Origin、Sec-Fetch-Site 和 challenge；
- mutation 二次本机确认；
- 只接收 install intent id，不接收任意 spec/argv；
- policy 重新拉取 catalog 中的签名记录并校验 digest；
- 文件写入使用原子替换，日志与 token 权限最小化；
- 对 profile 做互斥锁与目录边界检查；
- 自动更新 Companion 也必须签名并可回滚。

## 7. 兼容验证

由于 DSH 尚未稳定，兼容矩阵按滚动窗口维护：

- 最新 release candidate；
- 最新 master snapshot；
- Windows/Linux/macOS 代表环境；
- Node 最低支持线与当前 LTS；
- Web/headless/preset 相关 surface。

旧证据过期后仍保留，但发现排序降权。若上游发生插件协议变更，批量重新排队相关版本。

## 8. 审核与治理流程

### 收录

候选→自动检查→人工处理身份/分类异常→发布。作者可 claim 现有条目，但不能删除历史来源和第三方证据。

### 安全报告

私密入口→确认严重度→临时限制推荐/安装→联系作者→修复/公告→解除或永久撤回。严重恶意行为允许立即 deny digest/source。

### 普通争议

错误分类、商标、评价争议和兼容误判走可审计工单。作者有回应权，维护者决定证据呈现，不替作者删除真实失败结果。

### 合集治理

合集维护者只能控制自己的 release，不能覆盖成员插件事实。被撤回成员会使合集变为 degraded，并阻断新的可复现 release 安装。

## 9. 隐私

默认不上传：

- DSH 会话内容；
- workspace 路径和文件；
- 凭据名/值；
- 完整进程环境；
- 用户安装清单。

可选兼容回执只含 coarse OS/arch、DSH/Node 版本、插件 digest、阶段结果和随机轮换安装 id。任何日志上传前提供脱敏预览。

## 10. 许可证与商标

- 索引第三方元数据不等于获得分发代码的权利；
- 预览图必须记录许可证/来源，默认热链或作者授权缓存；
- 无许可证项目可被发现但明确警告，不镜像代码；
- 项目名称需声明非 DeepSeek 官方产品，除非获得授权；
- takedown 与 DMCA 流程公开且可审计。
