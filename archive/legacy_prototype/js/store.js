/**
 * DSH Creative Workshop - State Store
 * 响应式全局状态管理器：对接 ApiClient，驱动 Profile 切换、Companion 状态机、多维检索、依赖拓扑与评价系统
 */

import { MOCK_PLUGINS, OFFICIAL_MODE_PRESETS } from './mock-data.js';
import { apiClient } from './api-client.js';

class WorkshopStore {
  constructor() {
    this.subscribers = new Set();

    const savedState = this._loadLocalState();

    this.state = {
      currentView: 'home', // 'home' | 'browse' | 'profile' | 'graph' | 'discussions' | 'about'
      currentProfile: savedState.currentProfile || 'default-web',
      availableProfiles: ['default-web', 'headless-agent', 'creative-sandbox'],
      companionConnected: savedState.companionConnected ?? true,
      
      plugins: savedState.plugins || MOCK_PLUGINS,
      presets: OFFICIAL_MODE_PRESETS,

      // 搜索与三态分面过滤
      searchQuery: '',
      triStateFilters: {}, // { 'kind:bundle': 1, 'provides:tools': 1, 'surface:web': -1 }
      activeKindFilter: 'all',
      timeRangeFilter: 'week', // 'today' | 'week' | 'month' | 'all'
      sortBy: 'hot', // 'hot' | 'installs' | 'updated'

      // 高级检索配置
      advancedFilters: {
        onlyVerified: false,
        excludeWarning: false,
        minRating: 0
      },

      // 模态框与抽屉调度状态
      quickViewPluginId: null,
      trustModalPlugin: null,
      configModalPlugin: null,
      depModalData: null,
      presetModalData: null,
      neighborDrawerKey: null,
      advancedSearchModalOpen: false,

      toasts: []
    };

    // 自动触发探针
    this.initProbe();
  }

  async initProbe() {
    const probe = await apiClient.probeCompanion();
    if (probe.online) {
      this.state.companionConnected = true;
      const profiles = await apiClient.getProfiles();
      if (profiles && profiles.length > 0) {
        this.state.availableProfiles = profiles;
      }
      this.notify();
    }
  }

  _loadLocalState() {
    try {
      const data = localStorage.getItem('dsh_workshop_state_v2');
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  _saveLocalState() {
    try {
      const toSave = {
        currentProfile: this.state.currentProfile,
        companionConnected: this.state.companionConnected,
        plugins: this.state.plugins
      };
      localStorage.setItem('dsh_workshop_state_v2', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Failed to save state to localStorage', e);
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this._saveLocalState();
    this.subscribers.forEach(fn => fn(this.state));
  }

  // 1. 视图与路由
  setView(viewName) {
    this.state.currentView = viewName;
    this.notify();
  }

  // 2. 目标 Profile 管理
  setProfile(profileName) {
    this.state.currentProfile = profileName;
    this.addToast(`已切换当前档案为 [${profileName}]`, 'info');
    this.notify();
  }

  addNewProfile(name) {
    if (!name || this.state.availableProfiles.includes(name)) return;
    this.state.availableProfiles.push(name);
    this.state.currentProfile = name;
    this.addToast(`已成功创建并切换至新档案 [${name}]`, 'success');
    this.notify();
  }

  // 3. Companion 模拟器与探测切换
  toggleCompanion() {
    this.state.companionConnected = !this.state.companionConnected;
    if (this.state.companionConnected) {
      this.addToast('本地 Companion 代理已连接 (官方 dsh plugin 事务就绪)', 'success');
    } else {
      this.addToast('Companion 代理已断开 (主操作降级为命令复制模式)', 'warning');
    }
    this.notify();
  }

  // 4. 搜索与分面
  setSearchQuery(q) {
    this.state.searchQuery = q;
    this.notify();
  }

  setTriState(key, state) {
    if (state === 0) {
      delete this.state.triStateFilters[key];
    } else {
      this.state.triStateFilters[key] = state;
    }
    this.notify();
  }

  setTimeRange(range) {
    this.state.timeRangeFilter = range;
    this.notify();
  }

  clearAllFilters() {
    this.state.triStateFilters = {};
    this.state.searchQuery = '';
    this.state.activeKindFilter = 'all';
    this.state.advancedFilters = { onlyVerified: false, excludeWarning: false, minRating: 0 };
    this.addToast('已重置所有筛选与搜索条件', 'info');
    this.notify();
  }

  // 5. 安装状态机逻辑
  async installPlugin(pluginId) {
    const plugin = this.state.plugins.find(p => p.id === pluginId);
    if (!plugin) return;

    // 离线降级
    if (!this.state.companionConnected) {
      const cmd = `dsh plugin --profile ${this.state.currentProfile} add ${plugin.packageName}`;
      navigator.clipboard?.writeText(cmd);
      this.addToast(`已复制官方安装命令至剪贴板: ${cmd}`, 'info');
      return;
    }

    // 预检依赖
    if (plugin.relations && plugin.relations.length > 0) {
      const missingDeps = plugin.relations
        .filter(r => r.kind === 'requires')
        .map(r => this.state.plugins.find(p => p.id === r.target))
        .filter(p => p && !p.installed);

      if (missingDeps.length > 0) {
        this.state.depModalData = { plugin, missingDeps };
        this.notify();
        return;
      }
    }

    // 预检源码信任
    if (plugin.trust === 'git' || (plugin.permissions.lifecycleScripts?.required)) {
      this.state.trustModalPlugin = plugin;
      this.notify();
      return;
    }

    // 预检必填配置
    if (plugin.configSchema?.required?.length > 0 && !plugin.installedConfig) {
      this.state.configModalPlugin = plugin;
      this.notify();
      return;
    }

    await this._executeInstallTransaction(plugin);
  }

  async _executeInstallTransaction(plugin) {
    plugin._installing = true;
    this.notify();

    this.addToast(`正在通过 DSH 事务引擎预检与挂载 [${plugin.name}]...`, 'info');

    try {
      // 1. 创建计划
      const plan = await apiClient.createInstallPlan(plugin.id, this.state.currentProfile);
      
      // 2. 真实/模拟执行事务
      await apiClient.executeOperation(plan.planId, (evt) => {
        if (evt.data?.msg) {
          this.addToast(evt.data.msg, 'info');
        }
      });

      plugin._installing = false;
      plugin.installed = true;
      plugin.enabled = true;
      plugin.installOrder = this.state.plugins.filter(p => p.installed).length;

      this.addToast(`成功将 [${plugin.name}] 挂载进当前 Profile 档案！`, 'success');
    } catch (err) {
      plugin._installing = false;
      this.addToast(`安装失败: ${err.message}`, 'warning');
    }

    this.notify();
  }

  // 应用官方系统预设 (批量挂载)
  async applyPreset(presetId) {
    const preset = this.state.presets.find(x => x.id === presetId);
    if (!preset) return;

    this.addToast(`正在批量应用 [${preset.name}] 到当前档案...`, 'info');

    const matchingPlugins = this.state.plugins.filter(p => 
      preset.bundles.includes(p.packageName) || preset.bundles.some(b => p.id.includes(b.replace('@dsh/', '')))
    );

    for (const p of matchingPlugins) {
      if (!p.installed) {
        p.installed = true;
        p.enabled = true;
        p.installOrder = this.state.plugins.filter(x => x.installed).length + 1;
      }
    }

    await new Promise(r => setTimeout(r, 400));
    this.addToast(`[${preset.name}] 的全部核心 Bundle 已成功装入当前档案！`, 'success');
    this.notify();
  }

  // 卸载
  uninstallPlugin(pluginId) {
    const plugin = this.state.plugins.find(p => p.id === pluginId);
    if (!plugin) return;

    plugin.installed = false;
    plugin.enabled = false;
    plugin.installOrder = null;
    this.addToast(`已从档案移除 [${plugin.name}]`, 'info');
    this.notify();
  }

  // 切换启用/停用 (对应 patch disabled)
  togglePluginEnabled(pluginId) {
    const plugin = this.state.plugins.find(p => p.id === pluginId);
    if (!plugin || !plugin.installed) return;

    plugin.enabled = !plugin.enabled;
    this.addToast(`[${plugin.name}] 已${plugin.enabled ? '启用' : '停用'}`, 'info');
    this.notify();
  }

  // 一键全部更新
  updateAllSubscribed() {
    this.addToast('正在检查并更新当前档案中的全部已挂载 Bundle...', 'info');
    setTimeout(() => {
      this.addToast('当前档案中的所有插件均已同步至最新提交版本！', 'success');
      this.notify();
    }, 500);
  }

  // 档案层序重排
  reorderLayers(newOrderedIds) {
    newOrderedIds.forEach((id, idx) => {
      const p = this.state.plugins.find(x => x.id === id);
      if (p) p.installOrder = idx + 1;
    });
    this.addToast('已更新 Profile Bundle 层叠配置覆盖顺序', 'info');
    this.notify();
  }

  // 提交环境绑定评价
  async addReview(pluginId, rating, comment) {
    const plugin = this.state.plugins.find(p => p.id === pluginId);
    if (!plugin) return;

    const reviewData = {
      rating,
      comment: comment || '运行稳定，与当前环境无缝适配。',
      author: '当前开发者',
      profile: this.state.currentProfile,
      dshVersion: '0.1.0-rc.5',
      date: '刚刚'
    };

    await apiClient.submitReview(pluginId, reviewData);

    plugin.signals.reviewsCount += 1;
    plugin.signals.rating = Number(((plugin.signals.rating * (plugin.signals.reviewsCount - 1) + rating) / plugin.signals.reviewsCount).toFixed(1));
    
    if (!plugin.reviewsList) plugin.reviewsList = [];
    plugin.reviewsList.unshift(reviewData);

    this.addToast(`已为 [${plugin.name}] 提交环境绑定评价！`, 'success');
    this.notify();
  }

  // 模态与抽屉控制
  openQuickView(pluginId) {
    this.state.quickViewPluginId = pluginId;
    this.notify();
  }
  closeQuickView() {
    this.state.quickViewPluginId = null;
    this.notify();
  }

  openNeighborDrawer(capKey) {
    this.state.neighborDrawerKey = capKey;
    this.notify();
  }
  closeNeighborDrawer() {
    this.state.neighborDrawerKey = null;
    this.notify();
  }

  openPresetModal(presetId) {
    this.state.presetModalData = this.state.presets.find(p => p.id === presetId) || null;
    this.notify();
  }

  toggleAdvancedSearch(open) {
    this.state.advancedSearchModalOpen = open;
    this.notify();
  }

  closeAllModals() {
    this.state.trustModalPlugin = null;
    this.state.configModalPlugin = null;
    this.state.depModalData = null;
    this.state.presetModalData = null;
    this.state.advancedSearchModalOpen = false;
    this.notify();
  }

  // Toast 消息队列
  addToast(message, type = 'info') {
    const id = Date.now() + Math.random().toString();
    this.state.toasts.push({ id, message, type });
    this.notify();

    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter(t => t.id !== id);
      this.notify();
    }, 2800);
  }
}

export const store = new WorkshopStore();
