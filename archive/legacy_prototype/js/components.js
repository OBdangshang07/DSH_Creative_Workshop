/**
 * DSH Creative Workshop - UI Component Builders
 * 严格遵从官方规范，构建全交互卡片骨架、快览检查器、三态左栏、预设弹窗与高级检索模态
 */

import { store } from './store.js';
import { getArtworkHtml } from './artwork.js';

// 8 种形态官方极简几何 SVG 插图
export function getKindSvg(kind) {
  switch (kind) {
    case 'bundle':
    case 'mcp-bundle':
      return `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`;
    case 'cordis-plugin':
    case 'web-ui':
      return `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M12 6v3m0 6v3M6 12h3m6 0h3"/></svg>`;
    case 'skill-pack':
      return `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8m-8 4h5"/></svg>`;
    case 'collection':
      return `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="7" width="16" height="14" rx="2"/><path d="M6 3h14a2 2 0 0 1 2 2v12"/></svg>`;
    default:
      return `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
  }
}

// 1. 卡片骨架渲染 (PluginCard)
export function renderPluginCard(plugin) {
  const card = document.createElement('div');
  card.className = 'ds-card';
  card.dataset.id = plugin.id;

  let btnClass = 'state-idle';
  let btnText = '一键安装';
  let btnIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`;

  if (!store.state.companionConnected) {
    btnClass = 'state-copy';
    btnText = '复制安装命令';
    btnIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  } else if (plugin._installing) {
    btnClass = 'state-running';
    btnText = '正在预检事务...';
    btnIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
  } else if (plugin.installed) {
    btnClass = 'state-installed';
    btnText = plugin.enabled ? '已启用 (点击停用)' : '已停用 (点击启用)';
    btnIcon = `<span class="w-2 h-2 rounded-full bg-current"></span>`;
  } else if (plugin.trust === 'git') {
    btnClass = 'state-needs-trust';
    btnText = '审查并安装';
    btnIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  const capsHtml = [
    ...(plugin.capabilities.providesServices || []).slice(0, 2).map(s => `<span class="ds-chip-cap is-provide" data-cap="${s}" title="点击查看提供此服务的邻居">+${s}</span>`),
    ...(plugin.capabilities.injectsServices || []).slice(0, 2).map(s => `<span class="ds-chip-cap is-inject" data-cap="${s}" title="点击查看消费此服务的邻居">-${s}</span>`)
  ].join('');

  card.innerHTML = `
    <div class="ds-card-media" style="position:relative; overflow:hidden;">
      ${getArtworkHtml(plugin.id, plugin.name)}
      <button class="ds-card-quickview-btn js-qv-btn" title="查看完整检查器 (QuickView)" style="position:absolute; top:8px; right:8px; z-index:10;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
    </div>
    <div class="ds-card-body">
      <div class="ds-card-meta-line">
        <span class="ds-kind-badge">${plugin.kind}</span>
        <div class="ds-compat-lamp is-${plugin.signals.compatStatus}">
          <span class="ds-lamp-dot"></span>
          <span>${plugin.signals.compatStatus === 'verified' ? '兼容实测通过' : '需注意'}</span>
        </div>
      </div>
      <div class="ds-card-title" title="${plugin.name}">${plugin.name}</div>
      <div class="ds-card-author">by ${plugin.author}</div>
      
      <div class="ds-signal-bar" style="margin: 2px 0;">
        <span class="ds-signal-segment">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#FBBF24" style="display:inline-block; vertical-align:-1px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          ${plugin.signals.rating}
        </span>
        <span class="ds-signal-segment">${plugin.signals.installsCount} 装</span>
        <span class="ds-signal-segment ds-trend-up">${plugin.signals.recentTrend}</span>
      </div>

      <div class="ds-card-capabilities">
        ${capsHtml || '<span class="text-xs text-muted font-mono">独立运行</span>'}
      </div>

      <button class="ds-btn-install ${btnClass} mt-2 w-full js-install-btn">
        ${btnIcon}
        <span>${btnText}</span>
      </button>
    </div>
  `;

  // 1. 放大镜
  card.querySelector('.js-qv-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    store.openQuickView(plugin.id);
  });

  // 2. 主安装/启停按钮
  card.querySelector('.js-install-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (plugin.installed) {
      store.togglePluginEnabled(plugin.id);
    } else {
      store.installPlugin(plugin.id);
    }
  });

  // 3. 能力芯片
  card.querySelectorAll('.ds-chip-cap').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      store.openNeighborDrawer(chip.dataset.cap);
    });
  });

  // 4. 卡片主体点击
  card.addEventListener('click', () => {
    store.openQuickView(plugin.id);
  });

  return card;
}

// 2. 快览检查器面板 (QuickView Inspector)
export function renderQuickView(plugin) {
  if (!plugin) return null;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay is-open';

  overlay.innerHTML = `
    <div class="ds-quickview-panel">
      <div class="ds-quickview-header">
        <div class="ds-quickview-title-group">
          <span class="ds-kind-badge">${plugin.kind}</span>
          <span class="text-base font-semibold">${plugin.name}</span>
          <span class="text-xs font-mono text-muted">v${plugin.version}</span>
        </div>
        <button class="ds-quickview-close js-close-qv" title="按 ESC 或点击关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="ds-quickview-body">
        <!-- 左侧媒体与概览 -->
        <div class="ds-quickview-left">
          <div class="aspect-[16/9] rounded-md border border-white/10 overflow-hidden relative" style="min-height: 140px; background:#0E141B;">
            ${getArtworkHtml(plugin.id, plugin.name)}
          </div>
          <div class="text-xs text-secondary leading-relaxed">
            ${plugin.summary.short}
          </div>
          <div class="ds-signal-bar">
            <span class="ds-signal-segment">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#FBBF24" style="display:inline-block; vertical-align:-1px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${plugin.signals.rating} (${plugin.signals.reviewsCount} 评)
            </span>
            <span class="ds-signal-segment">${plugin.signals.installsCount} 安装</span>
            <span class="ds-signal-segment ds-trend-up">${plugin.signals.recentTrend}</span>
          </div>

          <div class="text-xs font-mono text-muted flex flex-col gap-1.5 p-2 bg-black/25 rounded border border-white/5">
            <div>目标 DSH 基线: <span class="text-primary">${plugin.targetDsh}</span></div>
            <div>运行表面支持: <span class="text-primary">${plugin.surfaces.join(', ')}</span></div>
            <div>开源许可协议: <span class="text-primary">${plugin.license}</span></div>
            <div>来源分发通道: <span class="text-primary">${plugin.trust}</span></div>
          </div>

          <button class="px-2.5 py-1.5 rounded bg-white/5 hover:bg-white/10 border border-default text-xs font-mono text-secondary hover:text-primary flex items-center justify-center gap-2 js-copy-pkg">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>复制包名</span>
          </button>
        </div>

        <!-- 右侧检查器 Tab 切换 -->
        <div class="ds-quickview-right">
          <div class="ds-inspector-tabs">
            <button class="ds-tab-btn is-active js-tab-btn" data-tab="specs">12 键规格表</button>
            <button class="ds-tab-btn js-tab-btn" data-tab="contrib">贡献与权限</button>
            <button class="ds-tab-btn js-tab-btn" data-tab="compat">兼容实测报告</button>
            <button class="ds-tab-btn js-tab-btn" data-tab="reviews">社区评价 (${plugin.reviewsList?.length || 0})</button>
          </div>

          <!-- Tab 1: 12 键严格规格表 -->
          <div class="js-tab-pane" data-pane="specs">
            <table class="ds-spec-table">
              <tbody>
                <tr><th>kind (形态)</th><td>${plugin.kind}</td></tr>
                <tr><th>role (角色)</th><td>${plugin.role}</td></tr>
                <tr><th>version (版本)</th><td>${plugin.version}</td></tr>
                <tr><th>targetDsh (基线)</th><td>${plugin.targetDsh}</td></tr>
                <tr><th>surfaces (表面)</th><td>${plugin.surfaces.join(' / ')}</td></tr>
                <tr><th>provides (提供)</th><td>${plugin.capabilities.providesServices?.join(', ') || '无'}</td></tr>
                <tr><th>injects (注入)</th><td>${plugin.capabilities.injectsServices?.join(', ') || '无'}</td></tr>
                <tr><th>requires (硬依赖)</th><td>${plugin.relations?.map(r => r.target).join(', ') || '无'}</td></tr>
                <tr><th>configRequired</th><td>${plugin.configSchema ? '需要必填配置' : '无需额外配置'}</td></tr>
                <tr><th>trust (来源)</th><td>${plugin.trust}</td></tr>
                <tr><th>license (许可)</th><td>${plugin.license}</td></tr>
                <tr><th>lastProven (实测)</th><td>${plugin.signals.compatSummary}</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Tab 2: 贡献与权限 -->
          <div class="js-tab-pane hidden" data-pane="contrib">
            <div class="flex flex-col gap-3 text-xs">
              <div class="font-semibold text-primary">模型上下文工具 / 钩子注册：</div>
              <div class="p-2.5 bg-black/30 rounded border border-white/10 font-mono text-secondary">
                ${plugin.permissions.modelContext.items?.join('<br>') || '无模型上下文注册项'}
              </div>
              <div class="font-semibold text-primary">文件与系统操作权限：</div>
              <div class="p-2.5 bg-black/30 rounded border border-white/10 text-secondary leading-relaxed">
                • 文件读取: ${plugin.permissions.filesystem.required ? '是 (' + plugin.permissions.filesystem.reason + ')' : '无'}<br>
                • 进程启动: ${plugin.permissions.process.required ? '需要启动本地进程' : '无'}<br>
                • 生命周期构建: ${plugin.permissions.lifecycleScripts?.required ? '包含本地构建脚本 (需信任)' : '无'}
              </div>
            </div>
          </div>

          <!-- Tab 3: 兼容报告 -->
          <div class="js-tab-pane hidden" data-pane="compat">
            <div class="flex flex-col gap-2 text-xs">
              <div class="p-3 bg-black/30 rounded border border-white/10 flex items-center justify-between">
                <div>
                  <span class="font-mono font-semibold text-primary">DSH 0.1.0-rc.5 (最新提交 47f9438)</span>
                  <div class="text-muted text-[11px] mt-0.5">测试于 2026-08-14 · 社区自动化雷达测试</div>
                </div>
                <span class="text-state-success font-medium">加载与调用通过</span>
              </div>
              <div class="p-3 bg-black/30 rounded border border-white/10 flex items-center justify-between">
                <div>
                  <span class="font-mono font-semibold text-primary">Node.js 22.19.0+ / 24.0.0</span>
                  <div class="text-muted text-[11px] mt-0.5">ESM 模块解析与 Cordis Fiber 兼容</div>
                </div>
                <span class="text-state-success font-medium">兼容</span>
              </div>
            </div>
          </div>

          <!-- Tab 4: 评价与提交表单 -->
          <div class="js-tab-pane hidden" data-pane="reviews">
            <div class="flex flex-col gap-4 text-xs">
              <!-- 提交表单 -->
              <form class="p-3 bg-black/30 rounded border border-white/10 flex flex-col gap-2.5 js-review-form">
                <div class="font-semibold text-primary">提交当前环境绑定评价</div>
                <div class="flex items-center gap-2">
                  <span class="text-muted">评分:</span>
                  <select class="bg-input border border-default p-1 rounded text-primary text-xs js-review-rating">
                    <option value="5">5星 (完美适配)</option>
                    <option value="4">4星 (表现良好)</option>
                    <option value="3">3星 (偶有告警)</option>
                  </select>
                </div>
                <textarea rows="2" maxlength="140" placeholder="评价该插件在当前环境的实际表现 (140字以内)..." class="w-full bg-input border border-default p-2 rounded text-primary text-xs js-review-comment"></textarea>
                <button type="submit" class="ds-btn-install state-idle text-xs w-fit">提交绑定评价</button>
              </form>

              <!-- 评价列表 -->
              <div class="flex flex-col gap-2">
                ${(plugin.reviewsList || [
                  { rating: 5, comment: '在 default-web 档案下与工作区巡检完美配合，秒级响应。', author: '开发者 #104', profile: 'default-web', dshVersion: '0.1.0-rc.5', date: '1 天前' }
                ]).map(r => `
                  <div class="p-2.5 bg-black/20 rounded border border-white/5 flex flex-col gap-1">
                    <div class="flex items-center justify-between text-muted text-[11px]">
                      <span class="text-yellow-400 font-mono">${r.rating}.0分 · ${r.author}</span>
                      <span class="font-mono">[${r.profile} · DSH ${r.dshVersion}] · ${r.date}</span>
                    </div>
                    <div class="text-secondary">${r.comment}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ds-quickview-footer">
        <div class="text-xs text-muted font-mono">
          当前目标 Profile: <span class="text-primary font-semibold">${store.state.currentProfile}</span>
        </div>
        <div class="flex items-center gap-3">
          ${plugin.installed ? `
            <button class="px-3 py-1.5 rounded text-xs text-danger hover:bg-danger/10 js-qv-uninstall">
              从档案移除
            </button>
          ` : ''}
          <button class="ds-btn-install ${plugin.installed ? 'state-installed' : 'state-idle'} js-qv-install-btn">
            ${plugin.installed ? (plugin.enabled ? '已挂载并启用' : '已挂载 (已停用)') : '一键挂载到当前档案'}
          </button>
        </div>
      </div>
    </div>
  `;

  // 绑定关闭
  overlay.querySelector('.js-close-qv').addEventListener('click', () => store.closeQuickView());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) store.closeQuickView();
  });

  // 绑定 Tab
  overlay.querySelectorAll('.js-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.js-tab-btn').forEach(b => b.classList.remove('is-active'));
      overlay.querySelectorAll('.js-tab-pane').forEach(p => p.classList.add('hidden'));

      btn.classList.add('is-active');
      overlay.querySelector(`[data-pane="${btn.dataset.tab}"]`).classList.remove('hidden');
    });
  });

  // 复制包名
  overlay.querySelector('.js-copy-pkg')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(plugin.packageName);
    store.addToast(`已复制包名: ${plugin.packageName}`, 'info');
  });

  // 卸载
  overlay.querySelector('.js-qv-uninstall')?.addEventListener('click', () => {
    store.uninstallPlugin(plugin.id);
    store.closeQuickView();
  });

  // 安装 / 启停
  overlay.querySelector('.js-qv-install-btn').addEventListener('click', () => {
    if (plugin.installed) {
      store.togglePluginEnabled(plugin.id);
      store.closeQuickView();
    } else {
      store.installPlugin(plugin.id);
    }
  });

  // 提交评价
  overlay.querySelector('.js-review-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const rating = parseInt(overlay.querySelector('.js-review-rating').value, 10);
    const comment = overlay.querySelector('.js-review-comment').value;
    store.addReview(plugin.id, rating, comment);
  });

  return overlay;
}

// 3. 左栏三态过滤器渲染 (FilterRail)
export function renderFilterRail() {
  const container = document.createElement('div');
  container.className = 'ds-filter-rail';

  const filterConfigs = [
    {
      group: "形态 (Kind)",
      items: [
        { key: "kind:bundle", label: "标准 Bundle" },
        { key: "kind:cordis-plugin", label: "Cordis Plugin" },
        { key: "kind:skill-pack", label: "Skill Pack" },
        { key: "kind:mcp-bundle", label: "MCP 桥接" },
        { key: "kind:collection", label: "合集 Suite" }
      ]
    },
    {
      group: "能力键 (Capabilities)",
      items: [
        { key: "provides:tools", label: "提供 Tools" },
        { key: "injects:llm", label: "注入 LLM" },
        { key: "provides:memory", label: "提供 Memory" },
        { key: "injects:fs", label: "需要 FS 读写" }
      ]
    },
    {
      group: "表面与信任 (Surfaces & Trust)",
      items: [
        { key: "surface:web", label: "Web 客户端" },
        { key: "surface:headless", label: "Headless 终端" },
        { key: "trust:npm", label: "npm 精选源" },
        { key: "trust:git", label: "Git 本地构建" }
      ]
    }
  ];

  let html = `
    <div class="flex items-center justify-between pb-2 border-b border-subtle">
      <span class="text-xs font-mono font-semibold text-primary">三轴分面过滤</span>
      <button class="text-xs text-muted hover:text-danger js-clear-filters" title="清空全部条件">重置</button>
    </div>
  `;

  filterConfigs.forEach(cfg => {
    html += `
      <div class="ds-filter-group">
        <div class="ds-filter-group-title">${cfg.group}</div>
        ${cfg.items.map(item => {
          const currentVal = store.state.triStateFilters[item.key] || 0;
          return `
            <div class="ds-tristate-row" data-key="${item.key}">
              <span>${item.label}</span>
              <div class="ds-tristate-controls">
                <button class="ds-tristate-btn ${currentVal === 1 ? 'is-active-include' : ''}" data-val="1" title="必须包含 (+)">+</button>
                <button class="ds-tristate-btn ${currentVal === 0 ? 'text-primary font-bold' : ''}" data-val="0" title="忽略">·</button>
                <button class="ds-tristate-btn ${currentVal === -1 ? 'is-active-exclude' : ''}" data-val="-1" title="必须排除 (-)">-</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  });

  container.innerHTML = html;

  // 绑定三态
  container.querySelectorAll('.ds-tristate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.ds-tristate-row');
      const key = row.dataset.key;
      const val = parseInt(btn.dataset.val, 10);
      store.setTriState(key, val);
    });
  });

  container.querySelector('.js-clear-filters').addEventListener('click', () => {
    store.clearAllFilters();
  });

  return container;
}

// 4. 邻居关系抽屉 (Neighbor Drawer)
export function renderNeighborDrawer(capKey) {
  if (!capKey) return null;

  const overlay = document.createElement('div');
  overlay.className = 'ds-drawer-overlay is-open';

  const drawer = document.createElement('div');
  drawer.className = 'ds-neighbor-drawer is-open';

  const providers = store.state.plugins.filter(p => p.capabilities.providesServices?.includes(capKey));
  const consumers = store.state.plugins.filter(p => p.capabilities.injectsServices?.includes(capKey));

  drawer.innerHTML = `
    <div class="p-4 border-b border-subtle flex items-center justify-between bg-workbench">
      <div>
        <div class="text-xs font-mono text-muted uppercase">Seam 能力邻居网络</div>
        <div class="text-sm font-semibold text-primary mt-1">服务键: ${capKey}</div>
      </div>
      <button class="ds-quickview-close js-close-drawer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="flex-1 p-4 overflow-y-auto flex flex-col gap-4">
      <div>
        <div class="text-xs font-mono text-brand font-semibold mb-2">提供者 (Providers - ${providers.length}):</div>
        <div class="flex flex-col gap-2">
          ${providers.map(p => `
            <div class="p-2.5 bg-card rounded border border-default flex items-center justify-between text-xs cursor-pointer hover:border-brand" onclick="window._openFromDrawer('${p.id}')">
              <span class="font-medium text-primary">${p.name}</span>
              <span class="text-muted font-mono">${p.installed ? '已装' : '未装'}</span>
            </div>
          `).join('') || '<div class="text-xs text-muted">暂无已收录 Provider</div>'}
        </div>
      </div>

      <div>
        <div class="text-xs font-mono text-warning font-semibold mb-2">消费者 (Consumers - ${consumers.length}):</div>
        <div class="flex flex-col gap-2">
          ${consumers.map(p => `
            <div class="p-2.5 bg-card rounded border border-default flex items-center justify-between text-xs cursor-pointer hover:border-brand" onclick="window._openFromDrawer('${p.id}')">
              <span class="font-medium text-primary">${p.name}</span>
              <span class="text-muted font-mono">${p.installed ? '已装' : '未装'}</span>
            </div>
          `).join('') || '<div class="text-xs text-muted">暂无消费者</div>'}
        </div>
      </div>
    </div>
  `;

  window._openFromDrawer = (id) => {
    store.closeNeighborDrawer();
    store.openQuickView(id);
  };

  overlay.addEventListener('click', () => store.closeNeighborDrawer());
  drawer.querySelector('.js-close-drawer').addEventListener('click', () => store.closeNeighborDrawer());

  const wrap = document.createDocumentFragment();
  wrap.appendChild(overlay);
  wrap.appendChild(drawer);
  return wrap;
}

// 5. 信任插层 (TrustModal)
export function renderTrustModal(plugin) {
  if (!plugin) return null;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay is-open';

  overlay.innerHTML = `
    <div class="p-6 bg-panel border border-default rounded-modal max-w-md w-full shadow-popover flex flex-col gap-4">
      <div class="flex items-center gap-3 text-warning font-semibold text-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>源码构建信任确认 (Trust Check)</span>
      </div>

      <div class="text-xs text-secondary leading-relaxed flex flex-col gap-2">
        <div>该插件来源于非 npm 仓库，包含本地生命周期构建脚本：</div>
        <div class="p-2 bg-black/40 rounded border border-white/10 font-mono text-muted">
          ${plugin.packageName}<br>
          ${plugin.permissions.lifecycleScripts?.items?.join(' ') || 'pnpm allowBuilds'}
        </div>
        <div>1. 将在安装期执行作者指定的编译代码；</div>
        <div>2. 执行过程不处于 Agent 沙箱内部；</div>
        <div>3. 建议在测试 Profile 中使用。</div>
      </div>

      <div class="flex items-center justify-end gap-3 mt-2">
        <button class="px-3 py-1.5 rounded text-xs text-muted hover:text-primary js-trust-cancel">取消</button>
        <button class="ds-btn-install state-needs-trust text-xs js-trust-confirm">允许构建并挂载</button>
      </div>
    </div>
  `;

  overlay.querySelector('.js-trust-cancel').addEventListener('click', () => store.closeAllModals());
  overlay.querySelector('.js-trust-confirm').addEventListener('click', () => {
    store.closeAllModals();
    store._executeInstallTransaction(plugin);
  });

  return overlay;
}

// 6. 缺失依赖补齐插层 (DependencyClosureModal)
export function renderDependencyModal(data) {
  if (!data) return null;
  const { plugin, missingDeps } = data;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay is-open';

  overlay.innerHTML = `
    <div class="p-6 bg-panel border border-default rounded-modal max-w-md w-full shadow-popover flex flex-col gap-4">
      <div class="flex items-center gap-3 text-brand font-semibold text-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
        <span>依赖闭包确认 (Dependency Resolution)</span>
      </div>

      <div class="text-xs text-secondary leading-relaxed">
        挂载 <strong>${plugin.name}</strong> 需要以下前置依赖支持：
      </div>

      <div class="flex flex-col gap-2">
        ${missingDeps.map(dep => `
          <div class="p-2 bg-black/40 rounded border border-white/10 flex items-center justify-between text-xs">
            <span class="font-medium text-primary">${dep.name}</span>
            <span class="font-mono text-muted">${dep.packageName}</span>
          </div>
        `).join('')}
      </div>

      <div class="flex items-center justify-end gap-3 mt-2">
        <button class="px-3 py-1.5 rounded text-xs text-muted hover:text-primary js-dep-cancel">取消</button>
        <button class="ds-btn-install state-idle text-xs js-dep-confirm">一键安装此件及 ${missingDeps.length} 个依赖</button>
      </div>
    </div>
  `;

  overlay.querySelector('.js-dep-cancel').addEventListener('click', () => store.closeAllModals());
  overlay.querySelector('.js-dep-confirm').addEventListener('click', async () => {
    store.closeAllModals();
    for (const dep of missingDeps) {
      await store._executeInstallTransaction(dep);
    }
    await store._executeInstallTransaction(plugin);
  });

  return overlay;
}

// 7. 预设模式对比与详情弹窗 (PresetModal)
export function renderPresetModal(preset) {
  if (!preset) return null;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay is-open';

  overlay.innerHTML = `
    <div class="p-6 bg-panel border border-default rounded-modal max-w-lg w-full shadow-popover flex flex-col gap-4">
      <div class="flex items-center justify-between pb-2 border-b border-subtle">
        <div class="flex items-center gap-2">
          <span class="ds-kind-badge">${preset.badge}</span>
          <span class="text-base font-semibold text-primary">${preset.name}</span>
        </div>
        <button class="ds-quickview-close js-close-preset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="text-xs text-secondary leading-relaxed">
        ${preset.description}
      </div>

      <div class="flex flex-col gap-2">
        <div class="text-xs font-semibold text-primary">包含的 Bundle 清单 (${preset.bundles.length}):</div>
        <div class="flex flex-col gap-1.5 font-mono text-xs text-muted bg-black/30 p-3 rounded border border-white/5 max-h-48 overflow-y-auto">
          ${preset.bundles.map(b => `<div class="text-primary">• ${b}</div>`).join('')}
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 mt-2">
        <button class="px-3 py-1.5 rounded text-xs text-muted hover:text-primary js-close-preset">关闭</button>
        <button class="ds-btn-install state-idle text-xs js-apply-preset-confirm">一键应用至 [${store.state.currentProfile}]</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.js-close-preset').forEach(btn => {
    btn.addEventListener('click', () => store.closeAllModals());
  });

  overlay.querySelector('.js-apply-preset-confirm').addEventListener('click', () => {
    store.closeAllModals();
    store.applyPreset(preset.id);
  });

  return overlay;
}

// 8. 高级检索设置弹窗 (AdvancedSearchModal)
export function renderAdvancedSearchModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay is-open';

  overlay.innerHTML = `
    <div class="p-6 bg-panel border border-default rounded-modal max-w-md w-full shadow-popover flex flex-col gap-4">
      <div class="flex items-center justify-between pb-2 border-b border-subtle">
        <span class="text-sm font-semibold text-primary flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>高级检索与过滤规则</span>
        </span>
        <button class="ds-quickview-close js-close-adv">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="flex flex-col gap-3 text-xs">
        <label class="flex items-center justify-between p-2 bg-card rounded border border-default cursor-pointer">
          <span>仅展示 0.1.0-rc.5 实测通过项</span>
          <input type="checkbox" ${store.state.advancedFilters.onlyVerified ? 'checked' : ''} class="js-chk-verified">
        </label>
        <label class="flex items-center justify-between p-2 bg-card rounded border border-default cursor-pointer">
          <span>排除带警告/破坏性更新风险项</span>
          <input type="checkbox" ${store.state.advancedFilters.excludeWarning ? 'checked' : ''} class="js-chk-warning">
        </label>
      </div>

      <div class="flex items-center justify-end gap-3 mt-2">
        <button class="px-3 py-1.5 rounded text-xs text-muted hover:text-primary js-close-adv">取消</button>
        <button class="ds-btn-install state-idle text-xs js-save-adv">应用规则</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.js-close-adv').forEach(btn => {
    btn.addEventListener('click', () => store.toggleAdvancedSearch(false));
  });

  overlay.querySelector('.js-save-adv').addEventListener('click', () => {
    store.state.advancedFilters.onlyVerified = overlay.querySelector('.js-chk-verified').checked;
    store.state.advancedFilters.excludeWarning = overlay.querySelector('.js-chk-warning').checked;
    store.toggleAdvancedSearch(false);
    store.addToast('已应用高级检索过滤规则', 'info');
    store.notify();
  });

  return overlay;
}
