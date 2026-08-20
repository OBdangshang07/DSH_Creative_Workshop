/**
 * DSH Creative Workshop - Authentic GitHub Topics Mock Data
 * 基于 https://github.com/topics/dsh-plugin 抓取的真实开源生态项目
 * 严格遵从 workshop-manifest.schema.json 12 键规格规范
 */

export const MOCK_PLUGINS = [
  {
    id: "colleague-skill",
    slug: "colleague-skill",
    name: "Colleague Skill - Digital Life Meta Generator",
    packageName: "@titanwings/colleague-skill",
    kind: "skill-pack",
    role: "Provider",
    author: "titanwings",
    version: "1.0.4",
    targetDsh: ">=0.1.0-rc.5 <0.2.0",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless", "tui"],
    trust: "npm",
    license: "MIT",
    githubUrl: "https://github.com/titanwings/colleague-skill",
    summary: {
      short: "将冰冷的离别化为温暖的 Skill，欢迎加入数字生命1.0！Agent 技能自动蒸馏与元生成器。",
      useCases: ["自动技能代码蒸馏", "专家知识结构化提取", "跨会话数字生命人格构建"],
      audience: ["developer", "agent-builder"]
    },
    capabilities: {
      planes: ["agent"],
      providesServices: ["skill-generator", "knowledge-distillation"],
      injectsServices: ["tools", "llm"],
      registersSlots: [],
      registersRoutes: []
    },
    relations: [],
    permissions: {
      filesystem: { required: true, items: ["workspace:read", "skills:write"], reason: "读取专家对话并输出生成 Skill 规则" },
      process: { required: false, items: [] },
      network: { required: false, items: [] },
      credentials: { required: false, items: [] },
      modelContext: { required: true, items: ["tool:distill_skill", "tool:generate_meta_prompt"], reason: "注册模型元技能生成工具" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 5.0,
      reviewsCount: 382,
      installsCount: "21.0k",
      recentTrend: "+64% 7日",
      compatStatus: "verified",
      compatSummary: "16/16 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: true,
    enabled: true,
    installOrder: 1
  },
  {
    id: "modlens",
    slug: "modlens",
    name: "ModLens - First Vision Bridge for DSH",
    packageName: "@liustack/modlens",
    kind: "mcp-bundle",
    role: "Provider",
    author: "liustack",
    version: "0.8.2",
    targetDsh: ">=0.1.0-rc.3",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless"],
    trust: "npm",
    license: "Apache-2.0",
    githubUrl: "https://github.com/liustack/modlens",
    summary: {
      short: "首个专为 DSH 打造的视觉增强插件，为纯文本 Coding Agent 提供 OCR、排版与语义结构化解析。",
      useCases: ["粘贴截图即时提取 JSON 证据", "前端 UI 稿像素级还原", "长图 OCR 高精度识别"],
      audience: ["frontend", "designer", "developer"]
    },
    capabilities: {
      planes: ["agent", "host"],
      providesServices: ["vision", "ocr-service"],
      injectsServices: ["process", "tools"],
      registersSlots: ["conversation.input.image_paste"],
      registersRoutes: ["/api/vision/ocr"]
    },
    relations: [],
    permissions: {
      filesystem: { required: true, items: ["workspace:read"], reason: "读取用户拖入的本地设计稿图片" },
      process: { required: true, items: ["exec:ocr_engine"], reason: "调度本地轻量 OCR 视觉模型" },
      network: { required: false, items: [] },
      credentials: { required: false, items: [] },
      modelContext: { required: true, items: ["tool:inspect_image_structure"], reason: "向模型返回图片布局与 OCR 坐标" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.9,
      reviewsCount: 124,
      installsCount: "6.9k",
      recentTrend: "+45% 7日",
      compatStatus: "verified",
      compatSummary: "24/24 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: true,
    enabled: true,
    installOrder: 2
  },
  {
    id: "ipollowork-runtime",
    slug: "ipollowork-runtime",
    name: "iPolloWork - Next-Gen AI Workspace & Agent OS",
    packageName: "@devin-axis/ipollowork-runtime",
    kind: "bundle",
    role: "Bundle",
    author: "Devin-AXIS",
    version: "2.3.0",
    targetDsh: ">=0.1.0-rc.5",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless"],
    trust: "npm",
    license: "Source-Available",
    githubUrl: "https://github.com/Devin-AXIS/iPolloWork",
    summary: {
      short: "具备自演化 Agent 运行时的全栈 AI 工作台，无缝桥接 DSH 子智能体委派与生态协作。",
      useCases: ["多文档/多设计稿联动编辑", "Subagent 自动委派分流", "全流程自动化构建与交付"],
      audience: ["fullstack", "architect"]
    },
    capabilities: {
      planes: ["agent", "client", "host"],
      providesServices: ["workspace-evolution", "subagent-delegation"],
      injectsServices: ["llm", "tools", "fs", "process"],
      registersSlots: ["sidebar.tab.ipollowork"],
      registersRoutes: ["/api/ipollo/session"]
    },
    relations: [
      { kind: "requires", target: "colleague-skill", range: ">=1.0.0", reason: "用于多角色技能动态提取" }
    ],
    permissions: {
      filesystem: { required: true, items: ["workspace:all"], reason: "工作区全量代码读写与演化" },
      process: { required: true, items: ["spawn:subagents"], reason: "启动并行 Worker 进程" },
      network: { required: true, items: ["net:all"], reason: "集群多节点通信" },
      credentials: { required: true, items: ["all"], reason: "透传模型与集成凭据" },
      modelContext: { required: true, items: ["all"], reason: "上下文全维度调度" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.8,
      reviewsCount: 96,
      installsCount: "3.5k",
      recentTrend: "+29% 7日",
      compatStatus: "verified",
      compatSummary: "18/18 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: false,
    enabled: false,
    installOrder: null
  },
  {
    id: "deeptide-agent",
    slug: "deeptide-agent",
    name: "Deeptide - Swift-Native macOS Coding Agent",
    packageName: "@paean-ai/deeptide-agent",
    kind: "bundle",
    role: "Consumer",
    author: "paean-ai",
    version: "1.1.5",
    targetDsh: ">=0.1.0-rc.5",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["headless", "tui"],
    trust: "npm",
    license: "MIT",
    githubUrl: "https://github.com/paean-ai/deeptide",
    summary: {
      short: "专为 macOS 环境深度打磨的 Swift 原生高性能编码智能体，零延迟对接 DSH Cordis 运行时。",
      useCases: ["macOS 系统级原生 API 交互", "Xcode 项目自动重构", "毫秒级本地 AST 符号解析"],
      audience: ["ios-developer", "macos-power-user"]
    },
    capabilities: {
      planes: ["agent"],
      providesServices: ["swift-ast-engine"],
      injectsServices: ["process", "fs"],
      registersSlots: [],
      registersRoutes: []
    },
    relations: [],
    permissions: {
      filesystem: { required: true, items: ["workspace:read", "workspace:write"], reason: "修改 Swift/ObjC 工程源码" },
      process: { required: true, items: ["exec:swift", "exec:xcodebuild"], reason: "触发本地编译构建" },
      network: { required: false, items: [] },
      credentials: { required: false, items: [] },
      modelContext: { required: true, items: ["tool:xcode_build_check"], reason: "向模型反馈编译器错误" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.9,
      reviewsCount: 58,
      installsCount: "1.0k",
      recentTrend: "+15% 7日",
      compatStatus: "verified",
      compatSummary: "12/12 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: false,
    enabled: false,
    installOrder: null
  },
  {
    id: "mobius-agent-os",
    slug: "mobius-agent-os",
    name: "Mobius - Self-Evolving Open-Source Agent OS",
    packageName: "@nutshellai/mobius-agent-os",
    kind: "collection",
    role: "Bundle",
    author: "nutshellai-tech",
    version: "0.9.1",
    targetDsh: ">=0.1.0-rc.4",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless"],
    trust: "npm",
    license: "Apache-2.0",
    githubUrl: "https://github.com/nutshellai-tech/mobius",
    summary: {
      short: "首个开源自演化 Agent 操作系统，无缝连接团队成员、AI Agents、边缘设备与算力集群。",
      useCases: ["跨设备算力动态均衡", "多 Agent 任务流水线分发", "自适应环境故障恢复"],
      audience: ["devops", "enterprise-team"]
    },
    capabilities: {
      planes: ["agent", "host"],
      providesServices: ["cluster-os", "device-bridge"],
      injectsServices: ["network", "process", "llm"],
      registersSlots: ["settings.panel.cluster"],
      registersRoutes: ["/api/mobius/nodes"]
    },
    relations: [
      { kind: "requires", target: "dsh-cordis-mcp-bridge", range: ">=0.9.0", reason: "用于动态加载集群节点能力" }
    ],
    permissions: {
      filesystem: { required: true, items: ["data:mobius_cluster"], reason: "存储节点心跳与路由拓扑" },
      process: { required: true, items: ["spawn:nodes"], reason: "拉起边缘 Worker" },
      network: { required: true, items: ["p2p:listen"], reason: "集群内 P2P 发现与通信" },
      credentials: { required: true, items: ["cluster:token"], reason: "节点间双向 TLS 认证" },
      modelContext: { required: true, items: ["tool:dispatch_to_node"], reason: "模型端远程节点派发" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.7,
      reviewsCount: 73,
      installsCount: "913",
      recentTrend: "+22% 7日",
      compatStatus: "verified",
      compatSummary: "14/14 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: false,
    enabled: false,
    installOrder: null
  },
  {
    id: "dsh-web-ui",
    slug: "dsh-web-ui",
    name: "DSH Web UI - Task Board, Git Graph & Skin Suite",
    packageName: "@zhu1090093659/dsh-web-ui",
    kind: "web-ui",
    role: "Consumer",
    author: "zhu1090093659",
    version: "1.4.2",
    targetDsh: ">=0.1.0-rc.5",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web"],
    trust: "npm",
    license: "MIT",
    githubUrl: "https://github.com/zhu1090093659/dsh-web-ui",
    summary: {
      short: "为 DSH Web 客户端打造的全套界面增强皮肤库：任务看板、交互式 Git 拓扑图、实时 Token 仪表盘与侧边抽屉。",
      useCases: ["可视化任务看板跟踪", "Git Commit 树直观审查", "实时 Token 消耗热力监控"],
      audience: ["frontend", "all"]
    },
    capabilities: {
      planes: ["client"],
      providesServices: ["web-skin-center", "git-visualizer"],
      injectsServices: ["client", "dsh.client"],
      registersSlots: ["conversation.header.stats", "sidebar.panel.taskboard"],
      registersRoutes: ["/ui/theme/skins"]
    },
    relations: [],
    permissions: {
      filesystem: { required: true, items: ["workspace:read"], reason: "读取 git commit log 生成关系图" },
      process: { required: false, items: [] },
      network: { required: false, items: [] },
      credentials: { required: false, items: [] },
      modelContext: { required: false, items: [] },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.9,
      reviewsCount: 62,
      installsCount: "496",
      recentTrend: "+38% 7日",
      compatStatus: "verified",
      compatSummary: "10/10 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: false,
    enabled: false,
    installOrder: null
  },
  {
    id: "dsh-cordis-mcp-bridge",
    slug: "dsh-cordis-mcp-bridge",
    name: "Cordis MCP Bridge - Protocol Adapter",
    packageName: "@dsh/cordis-mcp-bridge",
    kind: "mcp-bundle",
    role: "Provider",
    author: "Cordiverse Team",
    version: "0.9.4",
    targetDsh: ">=0.1.0-rc.3",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless"],
    trust: "npm",
    license: "Apache-2.0",
    summary: {
      short: "无缝桥接 Model Context Protocol (MCP) 服务器，将外部服务转化为 Cordis 标准 Tools。",
      useCases: ["接入 Postgres MCP", "接入 GitHub MCP", "动态加载 stdio/sse 协议工具"],
      audience: ["integrator", "advanced-user"]
    },
    capabilities: {
      planes: ["agent", "host"],
      providesServices: ["tools", "mcp-manager"],
      injectsServices: ["process", "network"],
      registersSlots: ["client.settings.mcp"],
      registersRoutes: ["/api/mcp/servers"]
    },
    relations: [],
    permissions: {
      filesystem: { required: false, items: [] },
      process: { required: true, items: ["exec:stdio"], reason: "启动本地 MCP Server 守护进程" },
      network: { required: true, items: ["sse:connect"], reason: "连接远程 SSE MCP 节点" },
      credentials: { required: true, items: ["mcp:auth_tokens"], reason: "保存 MCP 服务器鉴权凭证" },
      modelContext: { required: true, items: ["tool:*"], reason: "动态将 MCP 工具挂载至上下文" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.9,
      reviewsCount: 236,
      installsCount: "6.5k",
      recentTrend: "+34% 7日",
      compatStatus: "verified",
      compatSummary: "28/28 通过 · 0.1.0-rc.5"
    },
    configSchema: {
      required: ["serverList"],
      properties: {
        serverList: { type: "string", title: "MCP 配置文件路径或端点", default: "" }
      }
    },
    installed: true,
    enabled: true,
    installOrder: 3
  },
  {
    id: "dsh-security-guard-audit",
    slug: "dsh-security-guard-audit",
    name: "Pre-execution Security Guard & Gate",
    packageName: "@dsh/security-guard-audit",
    kind: "bundle",
    role: "Provider",
    author: "Security SIG",
        version: "1.1.5",
    targetDsh: ">=0.1.0-rc.1",
    verifiedDshCommits: ["47f943859bef"],
    surfaces: ["web", "headless", "tui"],
    trust: "npm",
    license: "MIT",
    summary: {
      short: "拦截危险终端指令与高危权限调用的瀑布式（Waterfall）安全策略审计引擎。",
      useCases: ["防范 rm -rf 等破坏性操作", "高危网络访问二次确认", "敏感凭据脱敏"],
      audience: ["all"]
    },
    capabilities: {
      planes: ["host", "agent"],
      providesServices: ["security-policy"],
      injectsServices: ["tools"],
      registersSlots: [],
      registersRoutes: []
    },
    relations: [],
    permissions: {
      filesystem: { required: false, items: [] },
      process: { required: false, items: [] },
      network: { required: false, items: [] },
      credentials: { required: false, items: [] },
      modelContext: { required: true, items: ["hook:pre_tool_execute"], reason: "执行前置安全检查" },
      lifecycleScripts: { required: false, items: [] }
    },
    signals: {
      rating: 4.9,
      reviewsCount: 310,
      installsCount: "8.9k",
      recentTrend: "+42% 7日",
      compatStatus: "verified",
      compatSummary: "32/32 通过 · 0.1.0-rc.5"
    },
    configSchema: null,
    installed: true,
    enabled: true,
    installOrder: 4
  }
];

export const OFFICIAL_MODE_PRESETS = [
  {
    id: "standard-mode",
    name: "标准模式 (Standard)",
    slug: "standard",
    badge: "推荐基础",
    description: "官方标准 Agent 配置，搭载数字生命生成、视觉桥接、MCP 适配与安全拦截底座。",
    bundles: ["@titanwings/colleague-skill", "@liustack/modlens", "@dsh/cordis-mcp-bridge", "@dsh/security-guard-audit"]
  },
  {
    id: "ptc-mode",
    name: "PTC 自动化演化 (Program-aided Trial)",
    slug: "ptc",
    badge: "自主试错",
    description: "专为代码调试、试错重试与自动化单元测试优化的环境组合，集成 iPolloWork 与 Deeptide。",
    bundles: ["@devin-axis/ipollowork-runtime", "@paean-ai/deeptide-agent", "@dsh/security-guard-audit"]
  },
  {
    id: "minimal-mode",
    name: "极简极速 (Minimal)",
    slug: "minimal",
    badge: "零开销",
    description: "极致轻量的只读对话模式，无外部守护进程与网络监听，秒级冷启。",
    bundles: ["@dsh/security-guard-audit"]
  },
  {
    id: "creative-mode",
    name: "创造模式 (Creative & Cluster)",
    slug: "creative",
    badge: "分布式协同",
    description: "全面释放 Mobius 集群操作系统、Web UI 看板、视觉解析与多智能体协同的能力工坊。",
    bundles: ["@nutshellai/mobius-agent-os", "@zhu1090093659/dsh-web-ui", "@liustack/modlens", "@dsh/cordis-mcp-bridge"]
  }
];
