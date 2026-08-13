/**
 * DSH Creative Workshop - Application Main Entry
 * 视图路由器、全局导航调度、Profile 切换、拖拽重排与交互总线
 */

import { store } from './store.js';
import {
  renderPluginCard,
  renderQuickView,
  renderFilterRail,
  renderNeighborDrawer,
  renderTrustModal,
  renderDependencyModal,
  renderPresetModal,
  renderAdvancedSearchModal
} from './components.js';
import { GraphRenderer } from './graph-renderer.js';

let graphInstance = null;

export function initApp() {
  bindGlobalEvents();
  store.subscribe(renderCurrentState);
  renderCurrentState(store.state);
}

function bindGlobalEvents() {
  // 1. 顶栏导航 Tab 切换
  document.querySelectorAll('.js-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) store.setView(view);
    });
  });

  // 2. Profile 切换器下拉
  const profileBtn = document.getElementById('profileSwitcherBtn');
  const profileMenu = document.getElementById('profileDropdownMenu');
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle('hidden');
    });
  }

  // 3. Companion 在线模拟切换
  const companionBtn = document.getElementById('companionStatusBtn');
  if (companionBtn) {
    companionBtn.addEventListener('click', () => {
      store.toggleCompanion();
    });
  }

  // 4. Developer Preview 徽章点击
  document.querySelectorAll('.ds-logo-badge').forEach(badge => {
    badge.style.cursor = 'pointer';
    badge.title = '点击查看 DSH 0.1.0-rc.5 运行时基线说明';
    badge.addEventListener('click', () => {
      store.addToast('当前基线: DeepSeek Harness 0.1.0-rc.5 (Commit 47f9438 · Cordis 内核)', 'info');
    });
  });

  // 5. 全局搜索
  const searchInput = document.getElementById('globalSearchInput');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        store.setSearchQuery(e.target.value);
      }, 150);
    });
  }

  // 6. 快捷键
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === 'Escape') {
      store.closeAllModals();
      store.closeQuickView();
      store.closeNeighborDrawer();
      profileMenu?.classList.add('hidden');
    }
  });

  document.addEventListener('click', () => {
    profileMenu?.classList.add('hidden');
  });
}

function renderCurrentState(state) {
  // 1. 更新顶栏状态
  updateHeader(state);

  // 2. 更新主内容视图
  const mainEl = document.getElementById('appMain');
  if (!mainEl) return;
  mainEl.innerHTML = '';

  switch (state.currentView) {
    case 'home':
      mainEl.appendChild(renderHomeView(state));
      break;
    case 'browse':
      mainEl.appendChild(renderBrowseView(state));
      break;
    case 'profile':
      mainEl.appendChild(renderProfileView(state));
      break;
    case 'graph':
      mainEl.appendChild(renderGraphView(state));
      break;
    case 'discussions':
      mainEl.appendChild(renderDiscussionsView(state));
      break;
    case 'about':
      mainEl.appendChild(renderAboutView(state));
      break;
    default:
      mainEl.appendChild(renderHomeView(state));
  }

  // 3. 模态框与抽屉调度
  renderModalsAndDrawers(state);

  // 4. Toast 通知
  renderToasts(state);
}

function updateHeader(state) {
  // 高亮 Tab
  document.querySelectorAll('.js-nav-item').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === state.currentView);
  });

  // Profile 名称
  const curProfileText = document.getElementById('currentProfileText');
  if (curProfileText) curProfileText.textContent = state.currentProfile;

  // Profile 下拉菜单列表
  const menuList = document.getElementById('profileListContainer');
  if (menuList) {
    menuList.innerHTML = `
      ${state.availableProfiles.map(p => `
        <div class="px-3 py-1.5 text-xs hover:bg-white/10 cursor-pointer flex items-center justify-between ${p === state.currentProfile ? 'text-brand font-semibold' : 'text-secondary'}" onclick="window._setProfile('${p}')">
          <span>${p}</span>
          ${p === state.currentProfile ? '<span class="text-brand flex items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        </div>
      `).join('')}
      <div class="border-t border-subtle mt-1 pt-1">
        <div class="px-3 py-1.5 text-xs text-muted hover:text-primary cursor-pointer" onclick="window._createProfilePrompt()">
          + 新建 Profile 档案...
        </div>
      </div>
    `;
  }

  window._setProfile = (p) => store.setProfile(p);
  window._createProfilePrompt = () => {
    const name = prompt('请输入新 Profile 名称 (如 test-sandbox):');
    if (name) store.addNewProfile(name.trim());
  };

  // Companion 状态指示灯
  const compDot = document.getElementById('companionDot');
  const compLabel = document.getElementById('companionLabel');
  if (compDot && compLabel) {
    if (state.companionConnected) {
      compDot.className = 'w-2 h-2 rounded-full bg-state-success shadow-[0_0_8px_#10B981]';
      compLabel.textContent = 'Companion 已连接';
      compLabel.className = 'text-state-success font-mono text-xs';
    } else {
      compDot.className = 'w-2 h-2 rounded-full bg-warning';
      compLabel.textContent = 'Companion 离线 (命令模式)';
      compLabel.className = 'text-warning font-mono text-xs';
    }
  }
}

// 首页视图
function renderHomeView(state) {
  const container = document.createElement('div');
  container.className = 'flex flex-col gap-6 w-full max-w-7xl mx-auto pb-12';

  const installedCount = state.plugins.filter(p => p.installed).length;

  container.innerHTML = `
    <!-- 紧凑 Hero -->
    <div class="ds-workbench-hero">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div class="text-xs font-mono text-muted uppercase tracking-wider">DeepSeek Harness · Control Plane</div>
          <h1 class="text-2xl font-bold text-primary mt-1">创意工坊市场工作台</h1>
          <p class="text-xs text-secondary mt-1">标准化、声明式插件目录与 Seam 能力网络调度中心</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="p-2 bg-black/40 rounded border border-white/10 text-xs font-mono">
            已装载: <strong class="text-state-success">${installedCount} 件</strong>
          </div>
          <button class="ds-btn-install state-idle text-xs js-go-browse">
            浏览全部插件 →
          </button>
        </div>
      </div>
    </div>

    <!-- 4 种官方模式预设条 -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-mono font-semibold text-primary uppercase">官方运行模式预设 (Presets)</span>
        <span class="text-xs text-muted">一键将官方精选 Bundle 挂载入当前 Profile</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        ${state.presets.map(p => `
          <div class="ds-preset-card js-preset-card cursor-pointer" data-preset="${p.id}">
            <div class="ds-preset-badge">${p.badge}</div>
            <div class="ds-preset-title">${p.name}</div>
            <div class="ds-preset-desc">${p.description}</div>
            <div class="mt-3 flex items-center justify-between text-xs pt-2 border-t border-subtle">
              <span class="text-muted font-mono">${p.bundles.length} 个 Bundle</span>
              <button class="text-brand hover:underline font-semibold js-apply-preset-btn" data-preset="${p.id}">一键应用</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 货架 1: 本周最热门插件 (带翻页轮播) -->
    <div class="flex flex-col gap-3 mt-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-primary">本周热门插件 (7-Day Hot)</span>
          <span class="text-xs text-muted font-mono">反霸榜加权排序</span>
        </div>
        <button class="text-xs text-brand hover:underline js-go-browse">查看完整目录 →</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="homeHotGrid"></div>
    </div>

    <!-- 货架 2: 必备底座与框架 (Most Required Items) -->
    <div class="flex flex-col gap-3 mt-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-primary">必备底座与框架 (Most Required)</span>
          <span class="text-xs text-muted font-mono">被最多插件硬依赖的核心 Provider</span>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="homeRequiredGrid"></div>
    </div>
  `;

  // 挂载热门货架
  const hotGrid = container.querySelector('#homeHotGrid');
  state.plugins.slice(0, 4).forEach(p => hotGrid.appendChild(renderPluginCard(p)));

  // 挂载必备货架
  const reqGrid = container.querySelector('#homeRequiredGrid');
  state.plugins.filter(p => p.role === 'provider' || p.kind === 'bundle').slice(0, 4).forEach(p => reqGrid.appendChild(renderPluginCard(p)));

  // 绑定预设
  container.querySelectorAll('.js-preset-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('js-apply-preset-btn')) return;
      store.openPresetModal(card.dataset.preset);
    });
  });
  container.querySelectorAll('.js-apply-preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.applyPreset(btn.dataset.preset);
    });
  });

  // 跳转目录
  container.querySelectorAll('.js-go-browse').forEach(btn => {
    btn.addEventListener('click', () => store.setView('browse'));
  });

  return container;
}

// 目录浏览视图 (Browse View)
function renderBrowseView(state) {
  const container = document.createElement('div');
  container.className = 'ds-browse-layout w-full max-w-7xl mx-auto pb-12';

  // 左侧过滤器
  const leftRail = renderFilterRail();

  // 右侧网格与顶控制条
  const rightCol = document.createElement('div');
  rightCol.className = 'flex flex-col gap-4';

  const filteredPlugins = filterPlugins(state.plugins, state);

  rightCol.innerHTML = `
    <div class="flex items-center justify-between bg-panel p-3 rounded border border-default flex-wrap gap-2">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted font-mono">已筛选:</span>
        <strong class="text-primary">${filteredPlugins.length} 件插件</strong>
      </div>
      <div class="flex items-center gap-3">
        <!-- 排序方式下拉 -->
        <div class="flex items-center gap-1.5 text-xs text-muted">
          <span>排序:</span>
          <select class="bg-input border border-default py-1 px-2 rounded text-primary text-xs outline-none js-sort-select">
            <option value="hot" ${state.sortBy === 'hot' ? 'selected' : ''}>7日热度 (加权)</option>
            <option value="installs" ${state.sortBy === 'installs' ? 'selected' : ''}>安装总量</option>
            <option value="rating" ${state.sortBy === 'rating' ? 'selected' : ''}>社区评分</option>
          </select>
        </div>

        <button class="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-default text-xs text-secondary flex items-center gap-1.5 js-open-adv-gear" title="高级检索设置">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>高级设置</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" id="browseGrid"></div>
  `;

  const grid = rightCol.querySelector('#browseGrid');
  if (filteredPlugins.length === 0) {
    grid.innerHTML = `<div class="col-span-3 p-12 text-center text-muted text-xs">未找到符合当前三态过滤与搜索条件的插件</div>`;
  } else {
    filteredPlugins.forEach(p => grid.appendChild(renderPluginCard(p)));
  }

  // 绑定排序切换
  rightCol.querySelector('.js-sort-select')?.addEventListener('change', (e) => {
    store.state.sortBy = e.target.value;
    store.notify();
  });

  rightCol.querySelector('.js-open-adv-gear')?.addEventListener('click', () => {
    store.toggleAdvancedSearch(true);
  });

  container.appendChild(leftRail);
  container.appendChild(rightCol);
  return container;
}

// 过滤与排序函数
function filterPlugins(plugins, state) {
  let list = plugins.filter(p => {
    // 1. 搜索词匹配
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const match = p.name.toLowerCase().includes(q) ||
                    p.packageName.toLowerCase().includes(q) ||
                    p.summary.short.toLowerCase().includes(q);
      if (!match) return false;
    }

    // 2. 三态过滤器
    for (const [key, val] of Object.entries(state.triStateFilters)) {
      if (val === 1) { // 必须包含
        if (key.startsWith('kind:') && p.kind !== key.replace('kind:', '')) return false;
        if (key === 'provides:tools' && !p.capabilities.providesServices?.includes('tools')) return false;
        if (key === 'injects:llm' && !p.capabilities.injectsServices?.includes('llm')) return false;
        if (key === 'provides:memory' && !p.capabilities.providesServices?.includes('memory')) return false;
        if (key === 'injects:fs' && !p.capabilities.injectsServices?.includes('fs')) return false;
        if (key === 'surface:web' && !p.surfaces.includes('web')) return false;
        if (key === 'surface:headless' && !p.surfaces.includes('headless')) return false;
        if (key.startsWith('trust:') && p.trust !== key.replace('trust:', '')) return false;
      } else if (val === -1) { // 必须排除
        if (key.startsWith('kind:') && p.kind === key.replace('kind:', '')) return false;
        if (key === 'provides:tools' && p.capabilities.providesServices?.includes('tools')) return false;
        if (key === 'injects:llm' && p.capabilities.injectsServices?.includes('llm')) return false;
        if (key.startsWith('trust:') && p.trust === key.replace('trust:', '')) return false;
      }
    }

    // 3. 高级设置
    if (state.advancedFilters.onlyVerified && p.signals.compatStatus !== 'verified') return false;
    if (state.advancedFilters.excludeWarning && p.signals.compatStatus === 'warning') return false;

    return true;
  });

  // 排序执行
  if (state.sortBy === 'installs') {
    list.sort((a, b) => parseInt(b.signals.installsCount.replace(/[^0-9]/g, '')) - parseInt(a.signals.installsCount.replace(/[^0-9]/g, '')));
  } else if (state.sortBy === 'rating') {
    list.sort((a, b) => b.signals.rating - a.signals.rating);
  }

  return list;
}

// 档案层叠板视图 (Profile LayerStack - 支持真实 HTML5 拖拽重排)
function renderProfileView(state) {
  const container = document.createElement('div');
  container.className = 'flex flex-col gap-6 w-full max-w-4xl mx-auto pb-12';

  const installedPlugins = state.plugins.filter(p => p.installed);

  container.innerHTML = `
    <div class="flex items-center justify-between pb-4 border-b border-subtle">
      <div>
        <h2 class="text-xl font-bold text-primary">档案层叠配置管理器 (Profile LayerStack)</h2>
        <p class="text-xs text-muted mt-1">当前档案: <strong class="text-brand">${state.currentProfile}</strong> · 按照 Cordis 原则自下而上覆盖生效 (支持拖拽重新排序)</p>
      </div>
      <button class="ds-btn-install state-idle text-xs js-update-all">
        一键同步更新全部已装 Bundle
      </button>
    </div>

    <div class="flex flex-col gap-3" id="profileLayerList">
      ${installedPlugins.length === 0 ? `
        <div class="p-12 text-center text-muted text-xs bg-panel rounded border border-default">
          当前档案暂无挂载任何插件。您可以前往 <a href="#" class="text-brand js-go-browse">插件目录</a> 进行一键挂载。
        </div>
      ` : installedPlugins.map((p, idx) => `
        <div class="p-4 bg-panel rounded border border-default flex items-center justify-between gap-4 cursor-grab ds-layer-row" draggable="true" data-id="${p.id}" style="transition: transform 0.15s, border-color 0.15s;">
          <div class="flex items-center gap-3">
            <span class="text-xs font-mono text-muted font-bold">#${idx + 1}</span>
            <div class="text-muted text-sm cursor-grab">⋮⋮</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="ds-kind-badge">${p.kind}</span>
                <span class="font-semibold text-primary text-sm">${p.name}</span>
                <span class="text-xs font-mono text-muted">v${p.version}</span>
              </div>
              <div class="text-xs text-muted mt-0.5">${p.packageName}</div>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button class="px-2.5 py-1 rounded text-xs border ${p.enabled ? 'border-state-success text-state-success' : 'border-default text-muted'} js-toggle-enable" data-id="${p.id}">
              ${p.enabled ? '已启用' : '已停用'}
            </button>
            <button class="px-2.5 py-1 rounded text-xs text-danger hover:bg-danger/10 js-layer-remove" data-id="${p.id}">
              卸载
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // 绑定真实拖拽排序
  const listEl = container.querySelector('#profileLayerList');
  let draggedEl = null;

  listEl.querySelectorAll('.ds-layer-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedEl = row;
      row.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.style.opacity = '1';
      draggedEl = null;
      listEl.querySelectorAll('.ds-layer-row').forEach(r => r.style.borderTop = '');

      // 提取新顺序并持久化
      const newIds = Array.from(listEl.querySelectorAll('.ds-layer-row')).map(r => r.dataset.id);
      store.reorderLayers(newIds);
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedEl && draggedEl !== row) {
        row.style.borderTop = '2px solid #4D6BFE';
      }
    });

    row.addEventListener('dragleave', () => {
      row.style.borderTop = '';
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderTop = '';
      if (draggedEl && draggedEl !== row) {
        listEl.insertBefore(draggedEl, row);
      }
    });
  });

  // 绑定常规事件
  container.querySelector('.js-update-all')?.addEventListener('click', () => store.updateAllSubscribed());
  container.querySelectorAll('.js-toggle-enable').forEach(btn => {
    btn.addEventListener('click', () => store.togglePluginEnabled(btn.dataset.id));
  });
  container.querySelectorAll('.js-layer-remove').forEach(btn => {
    btn.addEventListener('click', () => store.uninstallPlugin(btn.dataset.id));
  });
  container.querySelector('.js-go-browse')?.addEventListener('click', () => store.setView('browse'));

  return container;
}

// Seam 图谱视图 (Graph View)
function renderGraphView(state) {
  const container = document.createElement('div');
  container.className = 'w-full max-w-7xl mx-auto h-[680px] bg-panel rounded-card border border-default flex flex-col overflow-hidden relative';

  container.innerHTML = `
    <div class="p-3 bg-workbench border-b border-subtle flex items-center justify-between text-xs z-10">
      <div class="flex items-center gap-3">
        <span class="font-semibold text-primary font-mono">Seam 服务网络关系拓扑 (Interactive Canvas)</span>
        <span class="text-muted">实线: Provider 提供 / 虚线: Consumer 注入 / 滚轮缩放 / 拖拽平移</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-default text-xs text-secondary js-reset-graph">
          重置视角
        </button>
      </div>
    </div>
    <div class="flex-1 w-full h-full relative" id="canvasContainer">
      <canvas id="seamCanvas" class="w-full h-full block"></canvas>
    </div>
  `;

  setTimeout(() => {
    const canvas = container.querySelector('#seamCanvas');
    if (canvas) {
      graphInstance = new GraphRenderer(canvas);
      graphInstance.render(state.plugins);
    }
  }, 50);

  container.querySelector('.js-reset-graph')?.addEventListener('click', () => {
    if (graphInstance) graphInstance.resetView();
  });

  return container;
}

// 社区讨论与评价流视图 (Discussions View)
function renderDiscussionsView(state) {
  const container = document.createElement('div');
  container.className = 'flex flex-col gap-6 w-full max-w-4xl mx-auto pb-12';

  container.innerHTML = `
    <div class="pb-4 border-b border-subtle">
      <h2 class="text-xl font-bold text-primary">环境绑定评价与兼容讨论流 (Community Reviews)</h2>
      <p class="text-xs text-muted mt-1">自动携带 DSH 运行时基线与目标 Profile 签名的真实实测反馈</p>
    </div>

    <div class="flex flex-col gap-3">
      ${state.plugins.map(p => `
        <div class="p-4 bg-panel rounded border border-default flex flex-col gap-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-primary text-sm">${p.name}</span>
              <span class="ds-kind-badge">${p.kind}</span>
            </div>
            <span class="text-yellow-400 font-mono text-xs flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#FBBF24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span>${p.signals.rating} (${p.signals.reviewsCount} 评)</span>
            </span>
          </div>

          <div class="text-xs text-secondary leading-relaxed bg-black/20 p-2.5 rounded border border-white/5">
            ${p.summary.short}
          </div>

          <div class="flex items-center justify-between text-[11px] text-muted font-mono pt-1">
            <span>实测签名: [DSH 0.1.0-rc.5 · default-web]</span>
            <button class="text-brand hover:underline js-open-plugin-review" data-id="${p.id}">查看 / 提交评价 →</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.js-open-plugin-review').forEach(btn => {
    btn.addEventListener('click', () => store.openQuickView(btn.dataset.id));
  });

  return container;
}

// 关于与开源协议视图 (About View)
function renderAboutView(state) {
  const container = document.createElement('div');
  container.className = 'flex flex-col gap-6 w-full max-w-3xl mx-auto pb-12 text-secondary text-xs leading-relaxed';

  container.innerHTML = `
    <div class="p-6 bg-panel rounded-card border border-default flex flex-col gap-4">
      <h2 class="text-xl font-bold text-primary">关于 DeepSeek Harness 创意工坊</h2>
      <p>
        DSH Creative Workshop 是面向 <a href="https://github.com/deepseek-ai/DeepSeek-Harness" target="_blank" class="text-brand">DeepSeek Harness</a> 官方生态的一站式市场控制平面 (Marketplace Control Plane)。
      </p>
      <div class="p-3 bg-black/40 rounded border border-white/10 font-mono text-muted">
        Runtime: Cordis 插件调度内核<br>
        Baseline Target: DSH 0.1.0-rc.5 (Commit 47f9438)<br>
        Protocol: Model Context Protocol (MCP) + Seam Service Keys<br>
        License: MIT Open Source
      </div>
      <div>
        <h3 class="text-sm font-semibold text-primary mb-2">五大核心设计原则：</h3>
        <ol class="list-decimal pl-4 flex flex-col gap-1.5 text-muted">
          <li><strong>一键式极简交互</strong>：支持事务预检、脉冲确认、在线/离线降级；</li>
          <li><strong>视觉主导与信息标准化</strong>：12 键严格元数据与官方暗色工作台美学；</li>
          <li><strong>社区驱动动态评价</strong>：环境签名绑定与 7 天反霸榜算法；</li>
          <li><strong>精准标签与网状检索</strong>：三轴正交分面与 Seam 邻居抽屉；</li>
          <li><strong>直观依赖与合集图谱</strong>：原生 Canvas 依赖拓扑与 Profile 层叠板。</li>
        </ol>
      </div>
    </div>
  `;

  return container;
}

// 调度模态框与抽屉
function renderModalsAndDrawers(state) {
  const modalContainer = document.getElementById('modalContainer');
  if (!modalContainer) return;
  modalContainer.innerHTML = '';

  // QuickView
  if (state.quickViewPluginId) {
    const p = state.plugins.find(x => x.id === state.quickViewPluginId);
    if (p) modalContainer.appendChild(renderQuickView(p));
  }

  // 邻居抽屉
  if (state.neighborDrawerKey) {
    const drawer = renderNeighborDrawer(state.neighborDrawerKey);
    if (drawer) modalContainer.appendChild(drawer);
  }

  // 信任插层
  if (state.trustModalPlugin) {
    modalContainer.appendChild(renderTrustModal(state.trustModalPlugin));
  }

  // 依赖插层
  if (state.depModalData) {
    modalContainer.appendChild(renderDependencyModal(state.depModalData));
  }

  // 预设插层
  if (state.presetModalData) {
    modalContainer.appendChild(renderPresetModal(state.presetModalData));
  }

  // 高级检索
  if (state.advancedSearchModalOpen) {
    modalContainer.appendChild(renderAdvancedSearchModal());
  }
}

// Toast
function renderToasts(state) {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  toastContainer.innerHTML = '';

  state.toasts.forEach(t => {
    const el = document.createElement('div');
    el.className = `ds-toast is-${t.type}`;
    const iconSvg = t.type === 'success' 
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
      : (t.type === 'warning'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`);

    el.innerHTML = `
      <span class="flex items-center">${iconSvg}</span>
      <span>${t.message}</span>
    `;
    toastContainer.appendChild(el);
  });
}
