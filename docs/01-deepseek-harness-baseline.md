# DeepSeek Harness 上游架构基线

## 1. 调研范围

本基线来自 DeepSeek Harness `master` 分支提交 `47f9438`，重点核对：

- `docs/architecture.md`、Cordis 教程与 capability seam 文档；
- profile、bundle 与 CLI 的实际加载代码；
- Web Client 插件的双阶段加载；
- 当前插件清单与设置页能力；
- repository 插件路径的删除决策；
- GitHub `dsh-plugin` topic 下的实际社区生态。

DSH 处于 Developer Preview。本文描述的是 2026-08-14 的事实快照，不是兼容承诺。

## 2. “Everything is a plugin”的真实含义

DSH 没有一个不断膨胀的特权核心。模型适配器、工具注册表、会话日志、Agent、Agent Loop、文件系统、沙箱、Web Host 和浏览器功能均作为 Cordis 插件挂载。

插件通过 `apply(ctx)` 或 `Service` 子类向 Context 提供能力。它们之间的关系主要由三种机制表达：

1. **Service**：插件提供具名能力，消费方用 `inject` 声明硬依赖；服务未就绪时消费方 Fiber 保持 `PENDING`。
2. **Event**：广播、串行、并行或 waterfall 扩展点；waterfall 监听器必须调用 `next()` 才会继续下游。
3. **Effect**：注册、监听器、子插件和外部资源与插件生命周期绑定；卸载会自动撤销贡献。

Fiber 的核心状态为 `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`，加载或配置校验失败进入 `FAILED`。依赖服务消失时，消费方也会卸载并在服务恢复后重新激活。因此“安装一个包”不等于“功能已工作”；至少要区分包已解析、配置行已挂载、Fiber 已激活和功能验收已通过。

## 3. Profile 与 Bundle 是官方外部分发路径

### 3.1 Profile

profile 位于 `$DSH_HOME/profiles/<name>`，主要包含：

- `package.json`：树外依赖，以及 `dsh.profile.bundles` 有序列表；
- `pnpm-workspace.yaml`：独立包环境；
- `cordis.patch.yml`：该 profile 的用户配置层；
- `cordis.yml`：启动时生成的空根，所有实际条目由 patch 叠加而来。

`web` 和 `headless` 首次使用时自动初始化。其他 profile 通过 `dsh plugin` 创建。

### 3.2 Bundle

bundle 是普通 npm/pnpm 包，在 `package.json` 中声明：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

patch 可插入多个 Cordis 配置行，也可按行 id 覆盖 `config` 或 `disabled`。按 id 覆盖会替换整段 `config`，不是深度合并。

启动时的确定性层序为：

1. `dsh.profile.bundles` 中的各 bundle patch；
2. profile 的 `cordis.patch.yml`；
3. home 级 `$DSH_HOME/cordis.patch.yml`；
4. `--patch` overlay；
5. 启动器拥有的少量硬覆盖，例如 telemetry opt-out。

`composeEntries()` 与真实启动共用同一套 `applyEntryPatches`，因此 `--dump-config` 可以作为安装预检和验收的重要事实源。

### 3.3 安装命令

`dsh plugin --profile <name> <pnpm args...>` 是 pnpm 的薄封装：

- 在 profile 目录运行 pnpm；
- 相对路径说明符会锚定到用户调用目录；
- 成功后扫描依赖；声明 `dsh.bundle` 的包会加入有序 bundle 列表；
- 被移除或不再声明 bundle 的依赖会离开列表；
- 未声明 bundle 的包只作为普通依赖安装，不会自动挂载 Cordis entry。

Git 源包可能运行 `prepare`，而 pnpm 11 默认阻止未经允许的构建脚本。这意味着“一键安装”必须把生命周期脚本、来源和允许执行的构建步骤显式呈现给用户。

### 3.4 只有一条官方外部分发路径

上游已经删除 `.dsh-plugin`、repository cache 与 repository-specific loader。官方决策明确要求外部插件统一使用 profile bundle 和普通包管理依赖。工坊不能把旧社区文档中的 `.dsh-plugin` 当作当前协议，也不应再造第二套运行时缓存。

## 4. Host、Agent 与 Client 是不同平面

### 4.1 Host 平面

Host 插件作用于 DSH 进程范围，例如 Web Server、设置服务、凭据、全局注册表和 API Gateway。Web 当前提供 `pluginInventory/list`，它直接投影 Loader entries，只包含：

- entry id；
- module specifier；
- 有效启用状态；
- 当前 Fiber 阶段。

它不提供来源、bundle 层、配置、历史、修改或安装能力。

### 4.2 Agent 平面

Web 会把很多模型能力放进 per-session agent preset。preset 本身是一份 `agent.cordis.yml`，在隔离 realm 中为一个 Agent 组合工具、提示词和 provider。现有 Web 插件配置页只覆盖少数 Host settings namespace，不能通用编辑 preset 插件。

工坊的“装到哪里”必须区分：

- profile / Host 安装；
- agent preset 安装或配置；
- 只作为依赖安装但不挂载；
- 可选 Client half。

### 4.3 浏览器 Client 插件

浏览器端使用同一份 Cordis Loader 管 Fiber 生命周期，但代码到达机制不同：

- 包通过 `dsh.client` 声明 `platform`、`inject` 和可选 `immediately`；
- `exports["./client"]` 指向独立构建的 client bundle；
- Host 扫描当前 Loader 树里已启用的包，生成 `window.__DSH_BOOT__` 图；
- 浏览器先预取必要脚本，再由 Loader 根据 service 依赖激活插件；
- UI 扩展通过 typed slot 注册，不允许插件之间以值 import 形成隐式耦合。

因此，工坊目录应把“Host half / Client half / Agent contribution / Bundle composition”作为独立能力声明，而不是只标记“这是 UI 插件”。

## 5. 现有 Web 能力与缺口

现有 Web 已具备：

- 当前 Loader entries 的只读、可搜索清单；
- 少量 Host 插件 settings namespace 的手写配置卡片；
- `settings.plugins.tab` 扩展 slot；
- API Gateway 和通用 Host route 注册能力。

现有限制：

- 清单没有安装来源、版本、bundle、依赖图、权限或兼容证据；
- 清单只在打开页面或重试时读一次，不订阅变化；
- 插件配置由 Host 白名单控制，树外插件无法自主暴露通用 schema；
- Agent preset 插件不在当前配置页中；
- 没有安全的通用远程安装 API；
- Web Server 默认仅是开发型载体，非回环绑定时没有 TLS 或认证。

## 6. 社区生态的实际形态

官方 README 只要求仓库添加 `dsh-plugin` topic。调研时 GitHub 搜索返回 417 个候选，但其中混有：

- 真正的 DSH bundle；
- 普通 Cordis 包；
- Skills、MCP、桌面客户端和周边基础设施；
- 合集、awesome list 和教程；
- 使用已删除协议的旧插件；
- 仅仅蹭 topic、没有可安装入口的仓库。

社区已经出现兼容性雷达、精选目录和薄控制台，这证明需求真实，也说明不能把 `topic == dsh-plugin` 直接等同于可安装插件。工坊的数据模型必须保留来源、分类结论和验证证据。

## 7. 对本项目的约束

1. DSH Loader 是运行时真相，工坊不得维护另一棵“已启用插件树”。
2. profile manifest、profile patch 与 lockfile 是本机持久化真相。
3. 安装必须通过官方 `dsh plugin`/pnpm 语义，或未来上游明确提供的管理 API。
4. bundle 层序具有语义，依赖图不能只看 `package.json.dependencies`。
5. 用户评论和扫描报告不是同一类数据，必须分开建模。
6. Developer Preview 下，任何兼容结论都必须绑定 DSH commit/version、插件 commit/version、环境和测试日期。
7. 安装第三方插件等价于执行受信任代码，不能用一个模糊的“安全”徽章掩盖风险。

## 8. 主要上游证据

- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [App Boot / Profiles](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md)
- [Profile implementation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/src/profile.ts)
- [Plugin CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/src/plugin.ts)
- [Web bundle patch](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/cordis.patch.yml)
- [Client module system](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.md)
- [Plugin inventory](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/plugin-inventory/README.md)
- [Removal of repository plugins](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/simplification/2026-08-09-remove-repository-plugin.md)
