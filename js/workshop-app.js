import { api, escapeHtml, formatTime } from '/js/account-api.js';

const main = document.getElementById('steamAppMain');
const state = {
  user: null,
  version: '1.1.4',
  items: [],
  facets: { kinds: [], surfaces: [], topics: [], authors: [], languages: [], licenses: [] },
  filters: { q: '', kind: '', surface: '', topic: '', author: '', language: '', license: '', sort: 'stars', page: 1 },
  total: 0,
  pageSize: 24,
  currentPlugin: null,
  reviewPage: 1,
  unreadNotifications: 0,
  presenceTimer: null,
  communityPage: 1,
  activityCategory: '',
};

const icons = {
  heart: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
  plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
};

function attribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function coverUrl(plugin) {
  const value = String(plugin.cover?.url || `/api/v1/plugins/${encodeURIComponent(plugin.id)}/cover.svg`);
  return value.startsWith('/api/v1/plugins/') ? value : `/api/v1/plugins/${encodeURIComponent(plugin.id)}/cover.svg`;
}

function mediaUrl(plugin, item) {
  const value = String(item?.url || '');
  return value.startsWith(`/api/v1/plugins/${encodeURIComponent(plugin.id)}/media/`) ? value : '';
}

function wireMediaFallbacks(root = document) {
  root.querySelectorAll('img[data-cover-fallback]').forEach(image => image.addEventListener('error', () => {
    if (image.dataset.fallbackApplied === 'true') return;
    image.dataset.fallbackApplied = 'true';
    image.src = '/assets/scheme-b-cyber-harness.svg';
  }, { once: true }));
  root.querySelectorAll('img[data-hide-on-error]').forEach(image => image.addEventListener('error', () => {
    image.closest('figure')?.setAttribute('hidden', '');
  }, { once: true }));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['github.com', 'www.github.com'].includes(url.hostname) ? url.href : '#';
  } catch {
    return '#';
  }
}

function pluginUrl(id) {
  return `/plugin/?id=${encodeURIComponent(id)}`;
}

function currentPath() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function goLogin(mode = 'login') {
  location.href = `/login/?mode=${mode}&returnTo=${encodeURIComponent(currentPath())}`;
}

function toast(message, kind = 'info') {
  document.querySelector('.dsh-toast')?.remove();
  const node = document.createElement('div');
  node.className = 'dsh-toast';
  node.dataset.kind = kind;
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function showError(error, fallback = '操作失败，请稍后重试') {
  toast(error?.message || fallback, 'error');
}

function installAccountUi() {
  const statusArea = document.querySelector('.steam-hero-subnav > div:last-child');
  if (statusArea && !document.getElementById('dshAccountButton')) {
    statusArea.insertAdjacentHTML('afterbegin', '<span class="dsh-api-badge" id="dshApiBadge">● API 检测中</span><span class="dsh-presence-badge" id="dshPresenceBadge" title="过去 90 秒内有前台活动的浏览器">当前在线 —</span><button class="dsh-account-btn" id="dshAccountButton">登录 / 注册</button>');
  }
  document.body.insertAdjacentHTML('beforeend', `
    <div class="dsh-dialog" id="dshDialog" role="dialog" aria-modal="true" aria-labelledby="dshDialogTitle">
      <section class="dsh-dialog-card">
        <header class="dsh-dialog-head"><h2 id="dshDialogTitle">用户中心</h2><button class="dsh-dialog-close" type="button" aria-label="关闭">×</button></header>
        <div class="dsh-dialog-body" id="dshDialogBody"></div>
      </section>
    </div>
  `);
  document.getElementById('dshAccountButton')?.addEventListener('click', () => state.user ? openAccount('overview') : goLogin());
  document.querySelector('#dshDialog .dsh-dialog-close')?.addEventListener('click', closeDialog);
  document.getElementById('dshDialog')?.addEventListener('click', event => { if (event.target.id === 'dshDialog') closeDialog(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });
}

function openDialog(title, html) {
  document.getElementById('dshDialogTitle').textContent = title;
  document.getElementById('dshDialogBody').innerHTML = html;
  document.getElementById('dshDialog').classList.add('open');
  document.querySelector('#dshDialog button, #dshDialog input, #dshDialog select')?.focus();
}

function closeDialog() {
  document.getElementById('dshDialog')?.classList.remove('open');
}

function updateIdentity() {
  const button = document.getElementById('dshAccountButton');
  if (button) {
    button.textContent = state.user ? `${state.user.username}${state.user.role === 'admin' ? ' · 管理' : ''}${state.unreadNotifications ? ` · ${state.unreadNotifications}` : ''}` : '登录 / 注册';
    button.title = state.unreadNotifications ? `${state.unreadNotifications} 条未读通知` : '';
  }
  const count = document.getElementById('topSubCount');
  if (count) count.textContent = `${state.user?.subscriptions?.length || 0} 件`;
  const menuCount = document.getElementById('menuSubCount');
  if (menuCount) menuCount.textContent = String(state.user?.subscriptions?.length || 0);
  const noticeCount = document.getElementById('menuNoticeCount');
  if (noticeCount) noticeCount.textContent = String(state.unreadNotifications);
  const version = document.getElementById('topProfileName');
  if (version) version.textContent = `v${state.version}`;
}

function setApiStatus(online) {
  const badge = document.getElementById('dshApiBadge');
  if (!badge) return;
  badge.textContent = online ? '● API 在线' : '● API 离线';
  badge.classList.toggle('offline', !online);
}

function setPresenceStatus(result) {
  const badge = document.getElementById('dshPresenceBadge');
  if (!badge) return;
  badge.textContent = Number.isFinite(result?.online) ? `当前在线 ${result.online}` : '当前在线 —';
  badge.classList.toggle('offline', !Number.isFinite(result?.online));
}

async function heartbeatPresence() {
  if (document.visibilityState !== 'visible') return;
  try {
    const response = await fetch('/api/v1/presence/heartbeat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('presence unavailable');
    setPresenceStatus(await response.json());
  } catch { setPresenceStatus(null); }
}

function startPresence() {
  heartbeatPresence();
  clearInterval(state.presenceTimer);
  state.presenceTimer = window.setInterval(heartbeatPresence, 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') heartbeatPresence(); });
}

function wireHeader() {
  document.querySelectorAll('.js-nav-home, .steam-hub-nav-item[data-tab="workshop"], .steam-hub-nav-item[data-tab="all"]').forEach(node => node.addEventListener('click', () => navigateCatalog(true)));
  document.querySelector('.js-nav-about')?.addEventListener('click', () => renderAbout(true));
  document.querySelectorAll('.js-nav-discussions, .steam-hub-nav-item[data-tab="discussions"]').forEach(node => node.addEventListener('click', () => renderDiscussions(true)));
  document.querySelector('.steam-hub-nav-item[data-tab="news"]')?.addEventListener('click', () => renderActivity(true));
  document.querySelector('.steam-hub-nav-item[data-tab="reviews"]')?.addEventListener('click', () => renderGlobalReviews(true));

  document.querySelector('.steam-hub-nav-item[data-tab="screenshots"]')?.addEventListener('click', () => renderMediaGallery(true));
  document.querySelectorAll('.steam-hub-nav-item[data-tab="artwork"], .steam-hub-nav-item[data-tab="streams"], .steam-hub-nav-item[data-tab="videos"], .steam-hub-nav-item[data-tab="guides"]').forEach(node => {
    node.setAttribute('aria-disabled', 'true');
    node.title = '该社区板块尚未接入真实后端';
    node.addEventListener('click', () => toast('该社区板块尚未接入真实后端，本版本不会模拟发布成功。'));
  });

  const browseButton = document.getElementById('browseDropdownBtn');
  const browseMenu = document.getElementById('browseMenu');
  const myButton = document.getElementById('myItemsDropdownBtn');
  const myMenu = document.getElementById('myItemsMenu');
  browseButton?.addEventListener('click', event => { event.stopPropagation(); browseMenu?.classList.toggle('is-open'); myMenu?.classList.remove('is-open'); });
  myButton?.addEventListener('click', event => { event.stopPropagation(); myMenu?.classList.toggle('is-open'); browseMenu?.classList.remove('is-open'); });
  document.addEventListener('click', () => { browseMenu?.classList.remove('is-open'); myMenu?.classList.remove('is-open'); });
  browseMenu?.querySelectorAll('[data-kind]').forEach(item => item.addEventListener('click', () => {
    if (item.dataset.kind === 'collection') return renderPublicCollections(true);
    state.filters = { ...state.filters, kind: item.dataset.kind === 'all' ? '' : item.dataset.kind, page: 1 };
    navigateCatalog(true);
  }));
  document.querySelector('.js-open-subscribed-menu')?.addEventListener('click', () => state.user ? openAccount('subscriptions') : goLogin());
  document.querySelector('.js-open-profile-switch')?.addEventListener('click', () => state.user ? openAccount('sessions') : goLogin());
  document.querySelector('.js-open-create-col')?.addEventListener('click', () => state.user ? openAccount('collections') : goLogin());
  document.querySelector('.js-open-notifications')?.addEventListener('click', () => state.user ? openAccount('notifications') : goLogin());
  document.getElementById('topSubCount')?.addEventListener('click', () => state.user ? openAccount('subscriptions') : goLogin());
}

function filtersFromUrl() {
  const params = new URLSearchParams(location.search);
  return {
    q: params.get('q') || '', kind: params.get('kind') || '', surface: params.get('surface') || '',
    topic: params.get('topic') || '', author: params.get('author') || '', language: params.get('language') || '',
    license: params.get('license') || '', sort: params.get('sort') || 'stars',
    page: Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1),
  };
}

function catalogQuery() {
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([key, value]) => {
    if (!value || (key === 'sort' && value === 'stars') || (key === 'page' && value === 1)) return;
    params.set(key, String(value));
  });
  return params;
}

function syncCatalogUrl(push = false) {
  const query = catalogQuery().toString();
  const url = `/${query ? `?${query}` : ''}`;
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}

function navigateCatalog(push = false, nextFilters = null) {
  activateHub('workshop');
  if (nextFilters) state.filters = { ...state.filters, ...nextFilters, page: 1 };
  syncCatalogUrl(push);
  loadCatalog();
}

function navigatePlugin(id, push = true) {
  hidePopover();
  if (push) history.pushState({}, '', pluginUrl(id));
  state.reviewPage = 1;
  renderPlugin(id);
}

function facetOptions(items, selected, allLabel) {
  return `<option value="">${escapeHtml(allLabel)}</option>${(items || []).map(item => `<option value="${attribute(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.value)} (${item.count})</option>`).join('')}`;
}

function cardHtml(plugin) {
  const favorited = state.user?.favorites?.includes(plugin.id);
  const subscribed = state.user?.subscriptions?.includes(plugin.id);
  const community = plugin.community || {};
  const score = Number(community.reviewScore || 0);
  return `
    <article class="dsh-card" data-plugin-id="${attribute(plugin.id)}" tabindex="0" aria-label="查看 ${attribute(plugin.name)} 详情">
      <div class="dsh-card-cover">
        <img src="${attribute(coverUrl(plugin))}" alt="${attribute(plugin.name)} 封面" loading="lazy" data-cover-fallback>
        <div class="dsh-card-actions">
          <button class="dsh-icon-button favorite ${favorited ? 'active' : ''}" data-action="favorite" type="button" title="${favorited ? '取消收藏' : '收藏'}" aria-label="${favorited ? '取消收藏' : '收藏'}">${icons.heart}</button>
          <button class="dsh-icon-button ${subscribed ? 'active' : ''}" data-action="subscribe" type="button" title="${subscribed ? '取消订阅' : '订阅更新'}" aria-label="${subscribed ? '取消订阅' : '订阅更新'}">${subscribed ? icons.check : icons.plus}</button>
        </div>
      </div>
      <div class="dsh-card-body">
        <div class="dsh-card-rating"><span>${score ? `★ ${score.toFixed(1)} · ${community.reviewCount} 评价` : '暂无社区评价'}</span><span>★ ${formatNumber(plugin.stars)}</span></div>
        <div class="dsh-card-title">${escapeHtml(plugin.name)}</div>
        <div class="dsh-card-author">创作者：${escapeHtml(plugin.author)}</div>
        <div class="dsh-card-description">${escapeHtml(plugin.description)}</div>
        <div class="dsh-card-meta"><span>${escapeHtml(plugin.kind)}</span><span>${escapeHtml(plugin.language || 'Other')}</span><span>${formatNumber(community.subscriptionCount)} 订阅</span></div>
        <div class="dsh-chip-row">${(plugin.surfaces || []).slice(0, 3).map(value => `<span class="dsh-chip neutral">${escapeHtml(value)}</span>`).join('')}</div>
      </div>
    </article>`;
}

function catalogHtml(result) {
  const facets = result.facets || state.facets;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return `
    <div class="dsh-source-banner"><strong>真实 DSH Bundle 目录</strong> · ${escapeHtml(result.verificationNotice || '')}<br>${escapeHtml(result.securityNotice || '')}</div>
    <div class="dsh-catalog-layout">
      <aside class="dsh-filter-panel" aria-label="插件筛选">
        <h2>精准检索</h2>
        <form id="catalogFilters">
          <label class="dsh-field">搜索<input name="q" value="${attribute(state.filters.q)}" placeholder="名称、作者、包名或描述"></label>
          <label class="dsh-field">插件形态<select name="kind">${facetOptions(facets.kinds, state.filters.kind, '全部形态')}</select></label>
          <label class="dsh-field">运行表面<select name="surface">${facetOptions(facets.surfaces, state.filters.surface, '全部表面')}</select></label>
          <label class="dsh-field">主题标签<select name="topic">${facetOptions(facets.topics, state.filters.topic, '全部标签')}</select></label>
          <label class="dsh-field">主要语言<select name="language">${facetOptions(facets.languages, state.filters.language, '全部语言')}</select></label>
          <label class="dsh-field">许可证<select name="license">${facetOptions(facets.licenses, state.filters.license, '全部许可证')}</select></label>
          <label class="dsh-field">排序<select name="sort">
            <option value="stars" ${state.filters.sort === 'stars' ? 'selected' : ''}>GitHub Stars</option>
            <option value="recent" ${state.filters.sort === 'recent' ? 'selected' : ''}>最近推送</option>
            <option value="rating" ${state.filters.sort === 'rating' ? 'selected' : ''}>社区评分</option>
            <option value="subscriptions" ${state.filters.sort === 'subscriptions' ? 'selected' : ''}>订阅数量</option>
            <option value="name" ${state.filters.sort === 'name' ? 'selected' : ''}>名称</option>
          </select></label>
          <div class="dsh-filter-actions"><button class="dsh-button primary" type="submit">应用筛选</button><button class="dsh-button" id="resetFilters" type="button">重置</button>${state.user ? '<button class="dsh-button" id="saveCurrentSearch" type="button">保存搜索</button>' : ''}</div>
        </form>
      </aside>
      <section class="dsh-catalog-main">
        <header class="dsh-catalog-head"><div><h2>DeepSeek Harness 插件</h2><p>仅显示固定 Commit、结构验证通过且经管理员批准的 Bundle</p></div><span class="dsh-result-meta">${result.total} 个结果 · 第 ${result.page}/${pages} 页</span></header>
        ${result.items.length ? `<div class="dsh-card-grid">${result.items.map(cardHtml).join('')}</div>` : '<div class="dsh-empty">没有符合当前条件的已审核插件。</div>'}
        ${pages > 1 ? `<nav class="dsh-pagination" aria-label="目录分页"><button class="dsh-button" data-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button><span>${result.page} / ${pages}</span><button class="dsh-button" data-page="${result.page + 1}" ${result.page >= pages ? 'disabled' : ''}>下一页</button></nav>` : ''}
      </section>
    </div>`;
}

async function loadCatalog() {
  main.innerHTML = '<div class="dsh-loading"><div class="dsh-skeleton"></div><p>正在读取已验证插件目录…</p></div>';
  const query = catalogQuery();
  query.set('pageSize', String(state.pageSize));
  try {
    const result = await api(`/plugins?${query}`);
    state.items = result.items;
    state.facets = result.facets || state.facets;
    state.total = result.total;
    main.innerHTML = catalogHtml(result);
    wireMediaFallbacks(main);
    wireCatalog();
    document.title = 'DeepSeek Harness · DSH Creative Workshop';
  } catch (error) {
    main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}<br><button class="dsh-button" id="retryCatalog" type="button">重新加载</button></div>`;
    document.getElementById('retryCatalog')?.addEventListener('click', loadCatalog);
  }
}

function wireCatalog() {
  const form = document.getElementById('catalogFilters');
  form?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    state.filters = {
      ...state.filters, q: String(data.get('q') || '').trim(), kind: String(data.get('kind') || ''),
      surface: String(data.get('surface') || ''), topic: String(data.get('topic') || ''),
      language: String(data.get('language') || ''), license: String(data.get('license') || ''),
      sort: String(data.get('sort') || 'stars'), page: 1,
    };
    syncCatalogUrl(false); loadCatalog();
  });
  document.getElementById('resetFilters')?.addEventListener('click', () => {
    state.filters = { q: '', kind: '', surface: '', topic: '', author: '', language: '', license: '', sort: 'stars', page: 1 };
    syncCatalogUrl(false); loadCatalog();
  });
  document.getElementById('saveCurrentSearch')?.addEventListener('click', async () => {
    const name = prompt('为当前搜索命名（2–60 字）');
    if (!name) return;
    const query = Object.fromEntries(Object.entries(state.filters).filter(([key, value]) => key !== 'page' && value && !(key === 'sort' && value === 'stars')).map(([key, value]) => [key, String(value)]));
    try { await api('/me/saved-searches', { method: 'POST', body: JSON.stringify({ name: name.trim(), query }) }); toast('当前搜索已保存。'); }
    catch (error) { showError(error); }
  });
  main.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
    state.filters.page = Number(button.dataset.page); syncCatalogUrl(false); loadCatalog(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  main.querySelectorAll('.dsh-card').forEach(card => {
    card.addEventListener('click', event => handleCardClick(event, card));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.target.closest('button')) navigatePlugin(card.dataset.pluginId); });
    card.addEventListener('mouseenter', () => showPopover(card.dataset.pluginId, card));
    card.addEventListener('mouseleave', hidePopover);
  });
}

async function handleCardClick(event, card) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return navigatePlugin(card.dataset.pluginId);
  event.stopPropagation();
  if (!state.user) return goLogin();
  try {
    const result = await api(`/me/${action === 'favorite' ? 'favorites' : 'subscriptions'}/${encodeURIComponent(card.dataset.pluginId)}/toggle`, { method: 'POST' });
    if (action === 'favorite') state.user.favorites = result.favorites;
    else state.user.subscriptions = result.subscriptions;
    updateIdentity();
    await loadCatalog();
  } catch (error) { showError(error); }
}

function showPopover(pluginId, card) {
  const plugin = state.items.find(item => item.id === pluginId);
  const popover = document.getElementById('steamHoverPopover');
  if (!plugin || !popover) return;
  document.getElementById('popoverTitle').textContent = plugin.name;
  document.getElementById('popoverAuthor').textContent = `创作者：${plugin.author}`;
  document.getElementById('popoverDesc').textContent = plugin.description;
  document.getElementById('popoverSize').textContent = `${plugin.kind} · ${plugin.language || 'Other'}`;
  const rect = card.getBoundingClientRect();
  popover.style.left = `${Math.min(innerWidth - 370, rect.right + 8)}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - 250, rect.top))}px`;
  popover.classList.add('is-visible');
}

function hidePopover() {
  document.getElementById('steamHoverPopover')?.classList.remove('is-visible');
}

function stat(label, value) {
  return `<div class="dsh-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
}

function codeRow(label, value) {
  return `<div class="dsh-code-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(value ?? '—')}</code></div>`;
}

const changeLabels = { added: '新增', changed: '调整', fixed: '修复', removed: '移除', security: '安全', other: '其他' };
const sourceLabels = { declared: '插件声明', github_release: 'GitHub Release', changelog: 'CHANGELOG', commit: 'Commit 摘要', missing: '作者未提供', manual: '管理员整理', workshop_manifest: '平台发布清单' };

function releaseNotesHtml(release, options = {}) {
  if (!release) return '<div class="dsh-empty compact">该 Revision 暂无更新日志记录。</div>';
  const sourceUrl = release.sourceUrl ? safeExternalUrl(release.sourceUrl) : '#';
  const compareUrl = release.compareUrl ? safeExternalUrl(release.compareUrl) : '#';
  return `<div class="dsh-release-notes ${release.sourceType === 'missing' ? 'missing' : ''}">
    <div class="dsh-release-heading"><div><p class="dsh-kicker">${escapeHtml(release.version ? `VERSION ${release.version}` : 'REVISION CHANGELOG')}</p><h3>${escapeHtml(release.title)}</h3></div><span class="dsh-source-pill">${escapeHtml(sourceLabels[release.sourceType] || release.sourceType)}</span></div>
    <p class="dsh-release-summary">${escapeHtml(release.summary)}</p>
    ${release.breakingChanges?.length ? `<div class="dsh-breaking"><strong>不兼容变更</strong><ul>${release.breakingChanges.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
    ${release.changes?.length ? `<ul class="dsh-change-list">${release.changes.map(item => `<li><span data-change-type="${attribute(item.type)}">${escapeHtml(changeLabels[item.type] || item.type)}</span>${escapeHtml(item.text)}</li>`).join('')}</ul>` : release.sourceType === 'missing' ? '<p class="dsh-release-empty">未从插件声明、GitHub Release、CHANGELOG 或 Commit 信息中取得可展示内容。</p>' : ''}
    <div class="dsh-release-links">${compareUrl !== '#' ? `<a href="${attribute(compareUrl)}" target="_blank" rel="noopener noreferrer">比较固定 Commit ↗</a>` : ''}${sourceUrl !== '#' ? `<a href="${attribute(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看更新来源 ↗</a>` : ''}${release.collectedAt ? `<span>采集于 ${formatTime(release.collectedAt)}</span>` : ''}</div>
  </div>`;
}

function revisionHistoryHtml(revisions) {
  if (!revisions?.length) return '<div class="dsh-empty compact">暂无公开版本历史。</div>';
  return `<div class="dsh-revision-list">${revisions.map((revision, index) => `<details ${index === 0 ? 'open' : ''}><summary><span>${escapeHtml(revision.version || revision.commitSha.slice(0, 12))}</span><small>${formatTime(revision.publishedAt)} · ${escapeHtml(revision.commitSha.slice(0, 12))}</small></summary>${releaseNotesHtml(revision.release)}</details>`).join('')}</div>`;
}

function reviewsHtml(reviews, pluginState) {
  const own = pluginState?.review;
  return `
    <div class="dsh-review-summary"><strong class="dsh-review-score">${reviews.summary.score ? reviews.summary.score.toFixed(1) : '—'}</strong><div><div style="color:#f5c542">${reviews.summary.score ? '★'.repeat(Math.round(reviews.summary.score)) : '暂无评分'}</div><small style="color:#8f98a0">当前公开 Revision · ${reviews.summary.count} 条评价</small></div></div>
    ${state.user ? `<form class="dsh-review-form" id="reviewForm">
      <label class="dsh-field">评分<select name="rating">${[5,4,3,2,1].map(value => `<option value="${value}" ${Number(own?.rating || 5) === value ? 'selected' : ''}>${value} 星</option>`).join('')}</select></label>
      <label class="dsh-field">真实使用体验<textarea name="body" minlength="4" maxlength="1000" required placeholder="说明你实际使用后的体验，不要提交未验证结论。">${escapeHtml(own?.body || '')}</textarea></label>
      <button class="dsh-button primary" type="submit">${own ? '更新我的评价' : '发布评价'}</button>
    </form>` : `<div class="dsh-verification-note"><button class="dsh-button" id="loginForReview" type="button">登录后发布评价</button></div>`}
    <div class="dsh-review-list">${reviews.items.length ? reviews.items.map(review => `<article class="dsh-review"><div class="dsh-review-head"><strong>${escapeHtml(review.authorName)} · ${'★'.repeat(review.rating)}</strong><span>${formatTime(review.updatedAt)}</span></div><div class="dsh-review-body">${escapeHtml(review.body)}</div></article>`).join('') : '<div class="dsh-empty">当前 Revision 暂无评价。</div>'}</div>
    ${reviews.total > reviews.pageSize ? `<nav class="dsh-pagination"><button class="dsh-button" data-review-page="${reviews.page - 1}" ${reviews.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${reviews.page} 页</span><button class="dsh-button" data-review-page="${reviews.page + 1}" ${reviews.page * reviews.pageSize >= reviews.total ? 'disabled' : ''}>下一页</button></nav>` : ''}`;
}

function projectMediaHtml(plugin) {
  const media = (plugin.media || []).filter(item => mediaUrl(plugin, item));
  if (!media.length) return '<div class="dsh-empty compact">该仓库未提供可用的项目图片，已使用工坊确定性封面。</div>';
  return `<div class="dsh-media-grid">${media.map((item, index) => `<figure class="dsh-media-item"><img src="${attribute(mediaUrl(plugin, item))}" alt="${attribute(plugin.name)} 项目媒体 ${index + 1}" loading="lazy" data-hide-on-error><figcaption>${item.role === 'cover' ? '主封面' : `项目图 ${index + 1}`} · ${item.sourceType === 'package_preview' ? '仓库固定 Commit' : 'GitHub Social Preview'}</figcaption></figure>`).join('')}</div>`;
}

function relatedPluginsHtml(plugin, items) {
  if (!items?.length) return '<div class="dsh-empty compact">暂无可解释的相关推荐。</div>';
  return `<div class="dsh-related-list">${items.map(item => `<button class="dsh-related-item" data-related-plugin="${attribute(item.plugin.id)}" type="button"><img src="${attribute(coverUrl(item.plugin))}" alt="" loading="lazy" data-cover-fallback><span><strong>${escapeHtml(item.plugin.name)}</strong><small>${escapeHtml(item.reasons.join(' · '))}</small></span></button>`).join('')}</div>`;
}

function detailHtml(plugin, reviews, pluginState, revisions, relatedItems) {
  const verification = plugin.verification || {};
  const community = plugin.community || {};
  const favorited = Boolean(pluginState?.favorited || state.user?.favorites?.includes(plugin.id));
  const subscribed = Boolean(pluginState?.subscribed || state.user?.subscriptions?.includes(plugin.id));
  const dependencies = plugin.dependencies || [];
  return `
    <div class="dsh-detail">
      <nav class="dsh-breadcrumbs"><button id="backToCatalog" type="button">创意工坊</button><span>›</span><button data-author="${attribute(plugin.author)}" type="button">${escapeHtml(plugin.author)}</button><span>›</span><span>${escapeHtml(plugin.name)}</span></nav>
      <section class="dsh-detail-hero">
        <div class="dsh-detail-cover"><img src="${attribute(coverUrl(plugin))}" alt="${attribute(plugin.name)} 封面" data-cover-fallback></div>
        <div class="dsh-detail-summary">
          <p class="dsh-kicker">${escapeHtml(plugin.kind)} · ${escapeHtml((plugin.surfaces || []).join(' / '))}</p>
          <h1>${escapeHtml(plugin.name)}</h1>
          <button class="dsh-detail-author" data-author="${attribute(plugin.author)}" type="button" style="border:0;background:none;padding:0;text-align:left;cursor:pointer">由 ${escapeHtml(plugin.author)} 发布</button>
          <p class="dsh-detail-description">${escapeHtml(plugin.description)}</p>
          <div class="dsh-chip-row">${(plugin.topics || []).map(topic => `<button class="dsh-chip" data-topic="${attribute(topic)}" type="button">${escapeHtml(topic)}</button>`).join('')}</div>
          <div class="dsh-detail-actions">
            <a class="dsh-button primary" href="${attribute(safeExternalUrl(plugin.url))}" target="_blank" rel="noopener noreferrer">前往 GitHub ↗</a>
            <button class="dsh-button ${favorited ? 'success' : ''}" id="detailFavorite" type="button">${icons.heart} ${favorited ? '已收藏' : '收藏'}</button>
            <button class="dsh-button ${subscribed ? 'success' : ''}" id="detailSubscribe" type="button">${subscribed ? icons.check : icons.plus} ${subscribed ? '已订阅更新' : '订阅更新'}</button>
            <button class="dsh-button" id="addToCollection" type="button">加入合集</button>
            <button class="dsh-button" id="pluginDiscussions" type="button">讨论 ${formatNumber(community.discussionCount || 0)}</button>
            <button class="dsh-button" id="sharePlugin" type="button">复制站内链接</button>
            <button class="dsh-button" id="reportPluginMedia" type="button">反馈封面问题</button>
          </div>
        </div>
      </section>
      <div class="dsh-verification-note">此条目通过固定 Commit 的 DSH Bundle 结构验证并经管理员批准。它不是 DeepSeek 官方认证，也不代表代码安全审计；“订阅”仅保存社区关注关系，不会在本机安装代码。</div>
      <div class="dsh-detail-grid">
        <div>
          <section class="dsh-panel" id="projectMedia"><div class="dsh-panel-title-row"><div><h2>项目媒体</h2><p class="dsh-section-copy">图片仅从已验证仓库的固定 Commit 或 GitHub Social Preview 读取。</p></div><span class="dsh-source-pill">${formatNumber(plugin.mediaCount || 0)} 项</span></div>${projectMediaHtml(plugin)}</section>
          <section class="dsh-panel"><h2>标准化信息</h2><div class="dsh-stat-grid">
            ${stat('GitHub Stars', formatNumber(plugin.stars))}${stat('Forks', formatNumber(plugin.forks))}${stat('语言', plugin.language || 'Other')}${stat('许可证', plugin.license || '未声明')}
            ${stat('收藏', formatNumber(community.favoriteCount))}${stat('订阅', formatNumber(community.subscriptionCount))}${stat('当前评分', community.reviewScore ? community.reviewScore.toFixed(1) : '暂无')}${stat('讨论', formatNumber(community.discussionCount || 0))}${stat('最近推送', formatTime(plugin.pushedAt))}
          </div></section>
          <section class="dsh-panel"><h2>Bundle 验证证据</h2><div class="dsh-code-list">
            ${codeRow('Revision', plugin.revisionId)}${codeRow('固定 Commit', verification.commitSha)}${codeRow('package.json', verification.packageJsonPath)}${codeRow('Cordis Patch', verification.patchPath)}${codeRow('Entry IDs', (verification.entryIds || []).join(', ') || '—')}${codeRow('Module Specifiers', (verification.moduleSpecifiers || []).join(', ') || '—')}${codeRow('验证器', verification.verifierVersion || '—')}${codeRow('验证时间', formatTime(verification.checkedAt))}
          </div></section>
          <section class="dsh-panel"><h2>当前版本更新</h2>${releaseNotesHtml(plugin.release)}</section>
          <section class="dsh-panel"><h2>Revision 历史</h2>${revisionHistoryHtml(revisions)}</section>
          <section class="dsh-panel" id="communityReviews"><h2>社区评价</h2>${reviewsHtml(reviews, pluginState)}</section>
        </div>
        <aside class="dsh-detail-side">
          <section class="dsh-panel"><h2>同仓库与相关插件</h2>${relatedPluginsHtml(plugin, relatedItems)}</section>
          <section class="dsh-panel"><h2>声明依赖</h2>${dependencies.length ? `<div class="dsh-list">${dependencies.map(dep => `<div class="dsh-dependency"><div><strong>${escapeHtml(dep.packageName)}</strong><br><span>${dep.resolved ? '已解析为公开工坊插件' : '外部或尚未收录的包'}</span></div>${dep.resolved ? `<button class="dsh-button" data-dependency="${attribute(dep.pluginId)}" type="button">查看</button>` : ''}</div>`).join('')}</div>` : '<p style="color:#8f98a0;font-size:11px">当前固定 Revision 未声明可识别的 DSH/Cordis 包依赖。系统不会推测不存在的关系。</p>'}</section>
          <section class="dsh-panel"><h2>仓库信息</h2><div class="dsh-code-list">${codeRow('仓库', plugin.fullName)}${codeRow('包名', plugin.packageName || '—')}${codeRow('包目录', plugin.packagePath || '.')}${codeRow('数据来源', 'GitHub dsh-plugin Topic')}</div></section>
        </aside>
      </div>
    </div>`;
}

async function renderPlugin(id) {
  main.innerHTML = '<div class="dsh-loading"><div class="dsh-skeleton"></div><p>正在加载插件详情…</p></div>';
  try {
    const requests = [api(`/plugins/${encodeURIComponent(id)}`), api(`/plugins/${encodeURIComponent(id)}/reviews?page=${state.reviewPage}&pageSize=20`), api(`/plugins/${encodeURIComponent(id)}/revisions`), api(`/plugins/${encodeURIComponent(id)}/related?limit=8`)];
    if (state.user) requests.push(api(`/me/plugins/${encodeURIComponent(id)}/state`));
    const [pluginResult, reviews, revisionResult, relatedResult, userState] = await Promise.all(requests);
    const plugin = pluginResult.plugin;
    state.currentPlugin = plugin;
    main.innerHTML = detailHtml(plugin, reviews, userState?.state || null, revisionResult.items, relatedResult.items);
    wireMediaFallbacks(main);
    wireDetail(plugin, userState?.state || null);
    document.title = `${plugin.name} · DSH Creative Workshop`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    main.innerHTML = `<div class="dsh-error"><h2>无法打开插件详情</h2><p>${escapeHtml(error.message)}</p><button class="dsh-button" id="backAfterError" type="button">返回目录</button></div>`;
    document.getElementById('backAfterError')?.addEventListener('click', () => navigateCatalog(true));
  }
}

function wireDetail(plugin, pluginState) {
  document.getElementById('backToCatalog')?.addEventListener('click', () => navigateCatalog(true));
  main.querySelectorAll('[data-author]').forEach(button => button.addEventListener('click', () => navigateCatalog(true, { author: button.dataset.author })));
  main.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => navigateCatalog(true, { topic: button.dataset.topic })));
  main.querySelectorAll('[data-dependency]').forEach(button => button.addEventListener('click', () => navigatePlugin(button.dataset.dependency)));
  main.querySelectorAll('[data-related-plugin]').forEach(button => button.addEventListener('click', () => navigatePlugin(button.dataset.relatedPlugin)));
  document.getElementById('detailFavorite')?.addEventListener('click', () => toggleDetailRelation('favorites', plugin.id));
  document.getElementById('detailSubscribe')?.addEventListener('click', () => toggleDetailRelation('subscriptions', plugin.id));
  document.getElementById('addToCollection')?.addEventListener('click', () => state.user ? openPluginCollections(plugin) : goLogin());
  document.getElementById('pluginDiscussions')?.addEventListener('click', () => renderDiscussions(true, plugin.id));
  document.getElementById('sharePlugin')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('站内插件详情链接已复制。'); } catch { toast('无法访问剪贴板，请从地址栏复制链接。'); }
  });
  document.getElementById('reportPluginMedia')?.addEventListener('click', async () => {
    if (!state.user) return goLogin();
    const reason = prompt('请说明封面或项目图片的问题（3–500 字）：');
    if (!reason) return;
    try { await api(`/plugins/${encodeURIComponent(plugin.id)}/media/report`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }); toast('媒体问题已提交，管理员将在媒体中心处理。'); }
    catch (error) { showError(error); }
  });
  document.getElementById('loginForReview')?.addEventListener('click', () => goLogin());
  document.getElementById('reviewForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api(`/plugins/${encodeURIComponent(plugin.id)}/reviews`, { method: 'POST', body: JSON.stringify({ rating: Number(data.get('rating')), body: String(data.get('body') || '').trim() }) });
      toast(pluginState?.review ? '评价已更新。' : '评价已发布。');
      await renderPlugin(plugin.id);
    } catch (error) { showError(error); }
  });
  main.querySelectorAll('[data-review-page]').forEach(button => button.addEventListener('click', () => {
    state.reviewPage = Number(button.dataset.reviewPage); renderPlugin(plugin.id);
  }));
}

async function toggleDetailRelation(relation, pluginId) {
  if (!state.user) return goLogin();
  try {
    const result = await api(`/me/${relation}/${encodeURIComponent(pluginId)}/toggle`, { method: 'POST' });
    state.user[relation] = result[relation];
    updateIdentity();
    await renderPlugin(pluginId);
  } catch (error) { showError(error); }
}

function accountNav(view) {
  const items = [['overview','概览'],['profile','账号名'],['notifications',`通知${state.unreadNotifications ? ` ${state.unreadNotifications}` : ''}`],['favorites','收藏'],['subscriptions','订阅'],['searches','保存搜索'],['collections','合集'],['submissions','项目补录'],['sessions','设备会话'],['security','安全']];
  return `<nav class="dsh-account-nav">${items.map(([id,label]) => `<button class="dsh-button ${id === view ? 'active' : ''}" data-account-view="${id}" type="button">${label}</button>`).join('')}</nav>`;
}

function wireAccountNav() {
  document.querySelectorAll('[data-account-view]').forEach(button => button.addEventListener('click', () => renderAccount(button.dataset.accountView)));
}

async function openAccount(view = 'overview') {
  if (!state.user) return goLogin();
  openDialog('用户中心', '<div class="dsh-loading">正在读取账号数据…</div>');
  await renderAccount(view);
}

async function renderAccount(view) {
  const body = document.getElementById('dshDialogBody');
  body.innerHTML = `${accountNav(view)}<div class="dsh-loading">正在加载…</div>`;
  wireAccountNav();
  try {
    if (view === 'overview') renderAccountOverview(body, view);
    else if (view === 'profile') await renderProfile(body);
    else if (view === 'notifications') await renderNotifications(body);
    else if (view === 'favorites' || view === 'subscriptions') await renderRelations(body, view);
    else if (view === 'searches') await renderSavedSearches(body);
    else if (view === 'collections') await renderCollections(body);
    else if (view === 'submissions') await renderSubmissions(body);
    else if (view === 'sessions') await renderSessions(body);
    else renderSecurity(body);
  } catch (error) {
    body.innerHTML = `${accountNav(view)}<div class="dsh-error">${escapeHtml(error.message)}</div>`; wireAccountNav();
  }
}

function renderAccountOverview(body, view) {
  body.innerHTML = `${accountNav(view)}<div class="dsh-panel"><h2>${escapeHtml(state.user.username)}</h2><div class="dsh-stat-grid">${stat('角色', state.user.role === 'admin' ? '管理员' : '普通用户')}${stat('收藏', formatNumber(state.user.favorites.length))}${stat('订阅', formatNumber(state.user.subscriptions.length))}${stat('注册时间', formatTime(state.user.createdAt))}${stat('工坊版本', `v${state.version}`)}${stat('账号状态', state.user.status)}</div><div class="dsh-detail-actions">${state.user.role === 'admin' ? '<a class="dsh-button primary" href="/admin/">打开管理控制台</a>' : ''}<button class="dsh-button danger" id="logoutAccount" type="button">退出登录</button></div></div>`;
  wireAccountNav();
  document.getElementById('logoutAccount')?.addEventListener('click', logout);
}

async function renderProfile(body) {
  const { profile } = await api('/me/profile');
  const cooling = profile.nextChangeAt && Date.parse(profile.nextChangeAt) > Date.now();
  body.innerHTML = `${accountNav('profile')}<section class="dsh-panel"><h2>修改账号名</h2><p class="dsh-section-copy">修改时需要验证当前密码。每 30 天只能修改一次，旧账号名会保留 90 天，防止被他人立即注册。</p><form class="dsh-form-grid" id="changeUsernameForm"><label class="dsh-field">新账号名<input name="username" value="${attribute(profile.username)}" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" ${cooling ? 'disabled' : ''} required></label><label class="dsh-field">当前密码<input name="currentPassword" type="password" autocomplete="current-password" ${cooling ? 'disabled' : ''} required></label><button class="dsh-button primary" type="submit" ${cooling ? 'disabled' : ''}>确认修改</button></form><p class="dsh-message" id="profileMessage">${cooling ? `下次可修改时间：${formatTime(profile.nextChangeAt)}` : '允许字母、数字、点、下划线和连字符，首字符必须是字母或数字。'}</p></section>${profile.history.length ? `<section class="dsh-panel"><h2>最近修改记录</h2><div class="dsh-list">${profile.history.map(item => `<div class="dsh-list-item"><div><h3>${escapeHtml(item.oldUsername)} → ${escapeHtml(item.newUsername)}</h3><p>${formatTime(item.changedAt)} · 旧名保留至 ${formatTime(item.reservedUntil)}</p></div></div>`).join('')}</div></section>` : ''}`;
  wireAccountNav();
  document.getElementById('changeUsernameForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const message = document.getElementById('profileMessage');
    try {
      const result = await api('/me/profile', { method: 'PATCH', body: JSON.stringify({ username: String(data.get('username')).trim(), currentPassword: String(data.get('currentPassword')) }) });
      state.user = result.user; updateIdentity(); toast('账号名已更新。'); await renderProfile(body);
    } catch (error) { message.className = 'dsh-message error'; message.textContent = error.message; }
  });
}

async function renderSavedSearches(body) {
  const result = await api('/me/saved-searches');
  body.innerHTML = `${accountNav('searches')}<div class="dsh-list">${result.items.length ? result.items.map(item => `<div class="dsh-list-item"><div><h3>${escapeHtml(item.name)}</h3><p>${Object.entries(item.query).map(([key,value]) => `${escapeHtml(key)}=${escapeHtml(value)}`).join(' · ') || '默认目录条件'} · ${formatTime(item.updatedAt)}</p></div><div class="dsh-list-actions"><button class="dsh-button primary" data-apply-search="${attribute(item.id)}" type="button">应用</button><button class="dsh-button danger" data-delete-search="${attribute(item.id)}" type="button">删除</button></div></div>`).join('') : '<div class="dsh-empty">尚未保存搜索条件。可在目录筛选区保存当前组合。</div>'}</div>`;
  wireAccountNav();
  body.querySelectorAll('[data-apply-search]').forEach(button => button.addEventListener('click', () => {
    const selected = result.items.find(item => item.id === button.dataset.applySearch); if (!selected) return;
    state.filters = { q: '', kind: '', surface: '', topic: '', author: '', language: '', license: '', sort: 'stars', page: 1, ...selected.query };
    closeDialog(); navigateCatalog(true);
  }));
  body.querySelectorAll('[data-delete-search]').forEach(button => button.addEventListener('click', async () => { try { await api(`/me/saved-searches/${encodeURIComponent(button.dataset.deleteSearch)}`, { method: 'DELETE' }); await renderSavedSearches(body); } catch (error) { showError(error); } }));
}

async function renderSubmissions(body) {
  const result = await api('/me/plugin-submissions');
  const labels = { pending: '待审核', accepted: '已接收', rejected: '已拒绝' };
  body.innerHTML = `${accountNav('submissions')}<section class="dsh-panel"><h2>补录 GitHub 项目</h2><p class="dsh-section-copy">请提交仓库首页。仓库需设置 <code>dsh-plugin</code> Topic，并包含可验证的 DSH Bundle 与 Cordis patch；审核通过不等于安全背书。</p><form class="dsh-form-grid" id="pluginSubmissionForm"><label class="dsh-field wide">GitHub 仓库地址<input name="repositoryUrl" type="url" placeholder="https://github.com/owner/repository" required></label><button class="dsh-button primary" type="submit">提交补录</button></form><p class="dsh-message" id="pluginSubmissionMessage"></p></section><div class="dsh-list">${result.items.length ? result.items.map(item => `<div class="dsh-list-item"><div><h3>${escapeHtml(item.repositoryFullName)}</h3><p>${escapeHtml(labels[item.status] || item.status)} · ${formatTime(item.updatedAt)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</p></div><a class="dsh-button" href="${attribute(safeExternalUrl(item.repositoryUrl))}" target="_blank" rel="noopener noreferrer">查看仓库</a></div>`).join('') : '<div class="dsh-empty">尚未提交项目补录。</div>'}</div>`;
  wireAccountNav();
  document.getElementById('pluginSubmissionForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const message = document.getElementById('pluginSubmissionMessage');
    try { await api('/me/plugin-submissions', { method: 'POST', body: JSON.stringify({ repositoryUrl: String(data.get('repositoryUrl')).trim() }) }); toast('项目已进入管理员补录审核。'); await renderSubmissions(body); }
    catch (error) { message.className = 'dsh-message error'; message.textContent = error.message; }
  });
}

function notificationText(item) {
  if (item.type === 'plugin.updated') return `你订阅的 ${item.payload.name || '插件'} 发布了新 Revision${item.payload.release?.summary ? `：${item.payload.release.summary}` : ''}`;
  if (item.type === 'discussion.reply') return `${item.payload.authorName || '有用户'} 回复了讨论“${item.payload.threadTitle || ''}”`;
  if (item.type === 'collection.updated') return `合集“${item.payload.name || ''}”的治理状态已更新为 ${item.payload.status === 'hidden' ? '隐藏' : '可见'}`;
  if (item.type === 'workshop.release') return `工坊 v${item.payload.version || ''} 发布：${item.payload.summary || item.payload.title || ''}`;
  return String(item.payload.message || item.type);
}

async function renderNotifications(body) {
  const [result, preferenceResult] = await Promise.all([api('/me/notifications?pageSize=100'), api('/me/notification-preferences')]);
  const preferences = preferenceResult.preferences;
  state.unreadNotifications = result.unread;
  updateIdentity();
  body.innerHTML = `${accountNav('notifications')}<section class="dsh-panel"><div class="dsh-panel-title-row"><div><h2>通知偏好</h2><p class="dsh-section-copy">当前仅发送站内通知，不会向外部邮箱推送。</p></div></div><form class="dsh-preference-grid" id="notificationPreferences"><label><input type="checkbox" name="pluginUpdates" ${preferences.pluginUpdates ? 'checked' : ''}>插件版本更新</label><label><input type="checkbox" name="discussionReplies" ${preferences.discussionReplies ? 'checked' : ''}>关注讨论的新回复</label><label><input type="checkbox" name="collectionUpdates" ${preferences.collectionUpdates ? 'checked' : ''}>公开合集治理状态</label><label><input type="checkbox" name="platformReleases" ${preferences.platformReleases ? 'checked' : ''}>平台版本发布</label><button class="dsh-button primary" type="submit">保存偏好</button></form></section><div class="dsh-detail-actions" style="padding:0 0 12px"><button class="dsh-button" id="markAllNotifications" type="button" ${result.unread ? '' : 'disabled'}>全部标为已读</button></div><div class="dsh-list">${result.items.length ? result.items.map(item => `<div class="dsh-list-item ${item.readAt ? '' : 'unread'}"><div><h3>${escapeHtml(notificationText(item))}</h3><p>${formatTime(item.createdAt)}${item.readAt ? '' : ' · 未读'}</p></div><div class="dsh-list-actions">${item.pluginId ? `<button class="dsh-button" data-notification-plugin="${attribute(item.pluginId)}" type="button">查看插件</button>` : ''}${item.threadId ? `<button class="dsh-button" data-notification-thread="${attribute(item.threadId)}" type="button">查看讨论</button>` : ''}${item.payload.collectionId && item.payload.status !== 'hidden' ? `<button class="dsh-button" data-notification-collection="${attribute(item.payload.collectionId)}" type="button">查看合集</button>` : ''}</div></div>`).join('') : '<div class="dsh-empty">暂时没有通知。</div>'}</div>`;
  wireAccountNav();
  document.getElementById('notificationPreferences')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api('/me/notification-preferences', { method: 'PATCH', body: JSON.stringify({ pluginUpdates: data.has('pluginUpdates'), discussionReplies: data.has('discussionReplies'), collectionUpdates: data.has('collectionUpdates'), platformReleases: data.has('platformReleases') }) }); toast('通知偏好已保存。'); }
    catch (error) { showError(error); }
  });
  document.getElementById('markAllNotifications')?.addEventListener('click', async () => { await api('/me/notifications/read', { method: 'POST', body: JSON.stringify({}) }); await renderNotifications(body); });
  body.querySelectorAll('[data-notification-plugin]').forEach(button => button.addEventListener('click', async () => { await api('/me/notifications/read', { method: 'POST', body: JSON.stringify({}) }); closeDialog(); navigatePlugin(button.dataset.notificationPlugin); }));
  body.querySelectorAll('[data-notification-thread]').forEach(button => button.addEventListener('click', async () => { await api('/me/notifications/read', { method: 'POST', body: JSON.stringify({}) }); closeDialog(); renderDiscussionDetail(button.dataset.notificationThread, true); }));
  body.querySelectorAll('[data-notification-collection]').forEach(button => button.addEventListener('click', async () => { await api('/me/notifications/read', { method: 'POST', body: JSON.stringify({}) }); closeDialog(); renderPublicCollectionDetail(button.dataset.notificationCollection, true); }));
}

async function renderRelations(body, relation) {
  const result = await api(`/me/${relation}?pageSize=100`);
  const label = relation === 'favorites' ? '收藏' : '订阅';
  body.innerHTML = `${accountNav(relation)}<div class="dsh-list">${result.items.length ? result.items.map(entry => `<div class="dsh-list-item"><div><h3>${escapeHtml(entry.plugin.name)}</h3><p>${escapeHtml(entry.plugin.author)} · 保存于 ${formatTime(entry.savedAt)}</p></div><div class="dsh-list-actions"><button class="dsh-button" data-open-plugin="${attribute(entry.plugin.id)}" type="button">详情</button><button class="dsh-button danger" data-remove-relation="${relation}" data-plugin="${attribute(entry.plugin.id)}" type="button">移除</button></div></div>`).join('') : `<div class="dsh-empty">还没有${label}任何插件。</div>`}</div>`;
  wireAccountNav();
  body.querySelectorAll('[data-open-plugin]').forEach(button => button.addEventListener('click', () => { closeDialog(); navigatePlugin(button.dataset.openPlugin); }));
  body.querySelectorAll('[data-remove-relation]').forEach(button => button.addEventListener('click', async () => {
    try {
      const result = await api(`/me/${button.dataset.removeRelation}/${encodeURIComponent(button.dataset.plugin)}/toggle`, { method: 'POST' });
      state.user[button.dataset.removeRelation] = result[button.dataset.removeRelation]; updateIdentity(); await renderRelations(body, relation);
    } catch (error) { showError(error); }
  }));
}

function collectionEditor(collection) {
  return `<section class="dsh-panel" data-collection-card="${attribute(collection.id)}"><div class="dsh-form-grid">
    <label class="dsh-field">名称<input data-collection-name value="${attribute(collection.name)}" maxlength="80"></label>
    <label class="dsh-field">说明<input data-collection-description value="${attribute(collection.description)}" maxlength="500"></label>
    <label class="dsh-field">可见性<select data-collection-visibility><option value="private" ${collection.visibility === 'private' ? 'selected' : ''}>仅自己可见</option><option value="public" ${collection.visibility === 'public' ? 'selected' : ''}>公开到合集广场</option></select></label>
    <div class="dsh-field"><span>治理状态</span><strong>${escapeHtml(collection.moderationStatus === 'hidden' ? '已被管理员隐藏' : '正常')}</strong></div>
    <div class="wide"><div class="dsh-chip-row">${collection.pluginIds.length ? collection.pluginIds.map(id => `<button class="dsh-chip" data-remove-collection-plugin="${attribute(id)}" type="button" title="从合集移除">${escapeHtml(id)} ×</button>`).join('') : '<span style="color:#8f98a0;font-size:11px">空合集</span>'}</div></div>
    <div class="wide dsh-list-actions"><button class="dsh-button primary" data-save-collection type="button">保存更改</button><button class="dsh-button danger" data-delete-collection type="button">删除合集</button></div>
  </div></section>`;
}

async function renderCollections(body) {
  const result = await api('/me/collections');
  body.innerHTML = `${accountNav('collections')}<section class="dsh-panel"><h2>新建合集</h2><form class="dsh-form-grid" id="createCollectionForm"><label class="dsh-field">名称<input name="name" minlength="2" maxlength="80" required></label><label class="dsh-field">说明<input name="description" maxlength="500"></label><label class="dsh-field">可见性<select name="visibility"><option value="private">仅自己可见</option><option value="public">公开到合集广场</option></select></label><button class="dsh-button primary" type="submit">创建空合集</button></form><p class="dsh-message" id="collectionMessage"></p></section><div class="dsh-list">${result.items.map(collectionEditor).join('') || '<div class="dsh-empty">尚未创建合集。</div>'}</div>`;
  wireAccountNav();
  document.getElementById('createCollectionForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api('/me/collections', { method: 'POST', body: JSON.stringify({ name: String(data.get('name')).trim(), description: String(data.get('description') || '').trim(), visibility: String(data.get('visibility') || 'private'), pluginIds: [] }) }); await renderCollections(body); }
    catch (error) { document.getElementById('collectionMessage').textContent = error.message; }
  });
  body.querySelectorAll('[data-collection-card]').forEach(card => {
    const collection = result.items.find(item => item.id === card.dataset.collectionCard);
    card.querySelectorAll('[data-remove-collection-plugin]').forEach(button => button.addEventListener('click', () => { collection.pluginIds = collection.pluginIds.filter(id => id !== button.dataset.removeCollectionPlugin); button.remove(); }));
    card.querySelector('[data-save-collection]')?.addEventListener('click', async () => {
      try {
        await api(`/me/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', body: JSON.stringify({ name: card.querySelector('[data-collection-name]').value.trim(), description: card.querySelector('[data-collection-description]').value.trim(), visibility: card.querySelector('[data-collection-visibility]').value, pluginIds: collection.pluginIds }) });
        toast('合集已保存。'); await renderCollections(body);
      } catch (error) { showError(error); }
    });
    card.querySelector('[data-delete-collection]')?.addEventListener('click', async () => {
      if (!confirm(`确认删除合集“${collection.name}”？`)) return;
      try { await api(`/me/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' }); await renderCollections(body); } catch (error) { showError(error); }
    });
  });
}

async function openPluginCollections(plugin) {
  const result = await api('/me/collections');
  openDialog(`加入合集 · ${plugin.name}`, `<div class="dsh-list">${result.items.map(collection => `<label class="dsh-list-item"><div><h3>${escapeHtml(collection.name)}</h3><p>${collection.pluginIds.length} 个插件</p></div><input type="checkbox" data-collection-toggle="${attribute(collection.id)}" ${collection.pluginIds.includes(plugin.id) ? 'checked' : ''}></label>`).join('') || '<div class="dsh-empty">还没有合集，请先创建一个。</div>'}</div><section class="dsh-panel"><h2>新建并加入</h2><form class="dsh-form-grid" id="quickCollectionForm"><label class="dsh-field">名称<input name="name" minlength="2" maxlength="80" required></label><label class="dsh-field">说明<input name="description" maxlength="500"></label><button class="dsh-button primary" type="submit">创建合集</button></form><p class="dsh-message" id="quickCollectionMessage"></p></section>`);
  document.querySelectorAll('[data-collection-toggle]').forEach(input => input.addEventListener('change', async () => {
    const collection = result.items.find(item => item.id === input.dataset.collectionToggle);
    const pluginIds = input.checked ? [...new Set([...collection.pluginIds, plugin.id])] : collection.pluginIds.filter(id => id !== plugin.id);
    input.disabled = true;
    try { const updated = await api(`/me/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', body: JSON.stringify({ name: collection.name, description: collection.description, visibility: collection.visibility, pluginIds }) }); collection.pluginIds = updated.collection.pluginIds; toast(input.checked ? '已加入合集。' : '已从合集移除。'); }
    catch (error) { input.checked = !input.checked; showError(error); }
    finally { input.disabled = false; }
  }));
  document.getElementById('quickCollectionForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api('/me/collections', { method: 'POST', body: JSON.stringify({ name: String(data.get('name')).trim(), description: String(data.get('description') || '').trim(), visibility: 'private', pluginIds: [plugin.id] }) }); toast('合集已创建并加入当前插件。'); closeDialog(); }
    catch (error) { document.getElementById('quickCollectionMessage').textContent = error.message; }
  });
}

async function renderSessions(body) {
  const result = await api('/me/sessions');
  body.innerHTML = `${accountNav('sessions')}<div class="dsh-list">${result.items.map(session => `<div class="dsh-list-item"><div><h3>${escapeHtml(session.userAgent || '未知客户端')} ${session.current ? '· 当前会话' : ''}</h3><p>${escapeHtml(session.ip || '未知 IP')} · 最近活动 ${formatTime(session.lastSeenAt)} · 到期 ${formatTime(session.expiresAt)}</p></div><button class="dsh-button danger" data-revoke-session="${attribute(session.id)}" data-current="${session.current}" type="button">撤销</button></div>`).join('') || '<div class="dsh-empty">没有有效会话。</div>'}</div><div class="dsh-detail-actions"><button class="dsh-button danger" id="revokeOtherSessions" type="button">撤销其他设备</button></div>`;
  wireAccountNav();
  body.querySelectorAll('[data-revoke-session]').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/me/sessions/${encodeURIComponent(button.dataset.revokeSession)}`, { method: 'DELETE' }); if (button.dataset.current === 'true') { state.user = null; goLogin(); } else await renderSessions(body); }
    catch (error) { showError(error); }
  }));
  document.getElementById('revokeOtherSessions')?.addEventListener('click', async () => { try { const result = await api('/me/sessions/revoke-others', { method: 'POST' }); toast(`已撤销 ${result.revoked} 个其他会话。`); await renderSessions(body); } catch (error) { showError(error); } });
}

function renderSecurity(body) {
  body.innerHTML = `${accountNav('security')}<section class="dsh-panel"><h2>修改密码</h2><form class="dsh-form-grid" id="changePasswordForm"><label class="dsh-field">当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label class="dsh-field">新密码<input name="nextPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><button class="dsh-button primary" type="submit">更新密码</button></form><p class="dsh-message" id="securityMessage">新密码至少 10 位，并包含字母和数字。修改后所有设备需要重新登录。</p></section>`;
  wireAccountNav();
  document.getElementById('changePasswordForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const message = document.getElementById('securityMessage');
    try { await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), nextPassword: data.get('nextPassword') }) }); state.user = null; message.className = 'dsh-message success'; message.textContent = '密码已更新，正在返回登录页…'; window.setTimeout(() => goLogin(), 700); }
    catch (error) { message.className = 'dsh-message error'; message.textContent = error.message; }
  });
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } finally { state.user = null; state.unreadNotifications = 0; updateIdentity(); closeDialog(); navigateCatalog(true); }
}

function activateHub(tab) {
  document.querySelectorAll('.steam-hub-nav-item').forEach(item => item.classList.toggle('is-active', item.dataset.tab === tab));
}

function communityPager(result, handlerName) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (pages <= 1) return '';
  return `<nav class="dsh-pagination"><button class="dsh-button" data-community-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${result.page}/${pages} 页</span><button class="dsh-button" data-community-page="${result.page + 1}" ${result.page >= pages ? 'disabled' : ''}>下一页</button><span hidden data-page-handler="${handlerName}"></span></nav>`;
}

async function reportContent(targetType, targetId) {
  if (!state.user) return goLogin();
  const reason = prompt('请说明举报原因（4–500 字）');
  if (!reason) return;
  try { await api('/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason: reason.trim() }) }); toast('举报已提交，管理员会进行审核。'); }
  catch (error) { showError(error); }
}

async function renderDiscussions(push = false, pluginId = null) {
  state.communityPage = push ? 1 : state.communityPage;
  const params = new URLSearchParams({ view: 'discussions' });
  if (pluginId) params.set('pluginId', pluginId);
  if (push) history.pushState({}, '', `/?${params}`);
  activateHub('discussions');
  main.innerHTML = '<div class="dsh-loading">正在读取讨论区…</div>';
  try {
    const query = new URLSearchParams({ page: String(state.communityPage), pageSize: '20' });
    if (pluginId) query.set('pluginId', pluginId);
    const [result, catalog] = await Promise.all([api(`/discussions?${query}`), api('/plugins?pageSize=100&sort=name')]);
    const selectedPlugin = catalog.items.find(item => item.id === pluginId);
    main.innerHTML = `<div class="dsh-community-page"><header class="dsh-catalog-head"><div><p class="dsh-kicker">COMMUNITY DISCUSSIONS</p><h2>${selectedPlugin ? `${escapeHtml(selectedPlugin.name)} 讨论` : '讨论区'}</h2><p>围绕已审核插件交流使用方法、问题与兼容性，不以讨论替代安全审计。</p></div><span class="dsh-result-meta">${result.total} 个主题</span></header>
      ${state.user ? `<section class="dsh-panel"><h2>发起讨论</h2><form class="dsh-form-grid" id="discussionForm"><label class="dsh-field">标题<input name="title" minlength="4" maxlength="120" required></label><label class="dsh-field">关联插件<select name="pluginId"><option value="">全站讨论</option>${catalog.items.map(plugin => `<option value="${attribute(plugin.id)}" ${plugin.id === pluginId ? 'selected' : ''}>${escapeHtml(plugin.name)}</option>`).join('')}</select></label><label class="dsh-field wide">正文<textarea name="body" minlength="10" maxlength="5000" required></textarea></label><button class="dsh-button primary" type="submit">发布主题</button></form><p class="dsh-message" id="discussionMessage"></p></section>` : '<div class="dsh-verification-note"><button class="dsh-button" id="loginForDiscussion" type="button">登录后发起讨论</button></div>'}
      <div class="dsh-thread-list">${result.items.length ? result.items.map(thread => `<article class="dsh-thread-card" data-thread-id="${attribute(thread.id)}" tabindex="0"><div><p class="dsh-kicker">${thread.pluginName ? escapeHtml(thread.pluginName) : '全站讨论'} · ${thread.status === 'locked' ? '已锁定' : '开放'}</p><h3>${escapeHtml(thread.title)}</h3><p>${escapeHtml(thread.body.slice(0, 220))}</p></div><footer><span>${escapeHtml(thread.authorName)} · ${formatTime(thread.updatedAt)}</span><strong>${thread.replyCount} 回复</strong></footer></article>`).join('') : '<div class="dsh-empty">暂时没有讨论主题。</div>'}</div>${communityPager(result, 'discussions')}</div>`;
    document.getElementById('loginForDiscussion')?.addEventListener('click', () => goLogin());
    document.getElementById('discussionForm')?.addEventListener('submit', async event => { event.preventDefault(); const data = new FormData(event.currentTarget); const message = document.getElementById('discussionMessage'); try { const created = await api('/discussions', { method: 'POST', body: JSON.stringify({ title: String(data.get('title')).trim(), body: String(data.get('body')).trim(), pluginId: String(data.get('pluginId') || '') || undefined }) }); renderDiscussionDetail(created.thread.id, true); } catch (error) { message.textContent = error.message; } });
    main.querySelectorAll('[data-thread-id]').forEach(card => { card.addEventListener('click', () => renderDiscussionDetail(card.dataset.threadId, true)); card.addEventListener('keydown', event => { if (event.key === 'Enter') renderDiscussionDetail(card.dataset.threadId, true); }); });
    main.querySelectorAll('[data-community-page]').forEach(button => button.addEventListener('click', () => { state.communityPage = Number(button.dataset.communityPage); renderDiscussions(false, pluginId); }));
    document.title = '讨论区 · DSH Creative Workshop';
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

async function renderDiscussionDetail(id, push = false) {
  if (push) history.pushState({}, '', `/discussion/?id=${encodeURIComponent(id)}`);
  activateHub('discussions');
  main.innerHTML = '<div class="dsh-loading">正在读取讨论内容…</div>';
  try {
    const requests = [api(`/discussions/${encodeURIComponent(id)}`), api(`/discussions/${encodeURIComponent(id)}/replies?pageSize=100`)];
    if (state.user) requests.push(api(`/me/discussions/${encodeURIComponent(id)}/subscription`));
    const [{ thread }, replies, subscription] = await Promise.all(requests);
    main.innerHTML = `<div class="dsh-community-page"><nav class="dsh-breadcrumbs"><button id="backToDiscussions" type="button">讨论区</button><span>›</span><span>${escapeHtml(thread.title)}</span></nav><article class="dsh-thread-detail"><p class="dsh-kicker">${thread.pluginName ? escapeHtml(thread.pluginName) : '全站讨论'} · ${thread.status === 'locked' ? '已锁定' : '开放'}</p><h1>${escapeHtml(thread.title)}</h1><div class="dsh-thread-meta">${escapeHtml(thread.authorName)} · ${formatTime(thread.createdAt)}</div><p>${escapeHtml(thread.body)}</p><div class="dsh-list-actions">${thread.pluginId ? `<button class="dsh-button" id="openThreadPlugin" type="button">查看关联插件</button>` : ''}${state.user ? `<button class="dsh-button ${subscription?.subscribed ? 'success' : ''}" id="toggleDiscussionSubscription" type="button">${subscription?.subscribed ? '已关注讨论' : '关注讨论'}</button>` : ''}${state.user?.id === thread.authorId ? '<button class="dsh-button danger" id="deleteThread" type="button">删除主题</button>' : ''}${state.user && state.user.id !== thread.authorId ? '<button class="dsh-button" id="reportThread" type="button">举报</button>' : ''}</div></article>
      <section class="dsh-panel"><h2>${replies.total} 条回复</h2><div class="dsh-review-list">${replies.items.length ? replies.items.map(reply => `<article class="dsh-review"><div class="dsh-review-head"><strong>${escapeHtml(reply.authorName)}</strong><span>${formatTime(reply.createdAt)}</span></div><div class="dsh-review-body">${reply.status === 'deleted' ? '<em>该回复已由作者删除。</em>' : escapeHtml(reply.body)}</div>${reply.status !== 'deleted' ? `<div class="dsh-list-actions" style="margin-top:8px">${state.user?.id === reply.authorId ? `<button class="dsh-button danger" data-delete-reply="${attribute(reply.id)}" type="button">删除</button>` : state.user ? `<button class="dsh-button" data-report-reply="${attribute(reply.id)}" type="button">举报</button>` : ''}</div>` : ''}</article>`).join('') : '<div class="dsh-empty">尚无回复。</div>'}</div></section>
      ${thread.status === 'locked' ? '<div class="dsh-verification-note">该讨论已由管理员锁定，不能继续回复。</div>' : state.user ? `<section class="dsh-panel"><h2>回复讨论</h2><form class="dsh-form-grid" id="replyForm"><label class="dsh-field wide">回复内容<textarea name="body" minlength="2" maxlength="3000" required></textarea></label><button class="dsh-button primary" type="submit">发布回复</button></form><p class="dsh-message" id="replyMessage"></p></section>` : '<div class="dsh-verification-note"><button class="dsh-button" id="loginForReply" type="button">登录后回复</button></div>'}</div>`;
    document.getElementById('backToDiscussions')?.addEventListener('click', () => renderDiscussions(true, thread.pluginId || null));
    document.getElementById('openThreadPlugin')?.addEventListener('click', () => navigatePlugin(thread.pluginId));
    document.getElementById('loginForReply')?.addEventListener('click', () => goLogin());
    document.getElementById('reportThread')?.addEventListener('click', () => reportContent('thread', thread.id));
    document.getElementById('toggleDiscussionSubscription')?.addEventListener('click', async () => { try { const result = await api(`/me/discussions/${encodeURIComponent(thread.id)}/subscription`, { method: 'PUT', body: JSON.stringify({ subscribed: !subscription?.subscribed }) }); toast(result.subscribed ? '已关注讨论，新回复会进入站内通知。' : '已取消关注讨论。'); renderDiscussionDetail(thread.id, false); } catch (error) { showError(error); } });
    document.getElementById('deleteThread')?.addEventListener('click', async () => { if (!confirm('确认删除该讨论？')) return; await api(`/discussions/${encodeURIComponent(thread.id)}`, { method: 'DELETE' }); renderDiscussions(true, thread.pluginId || null); });
    document.getElementById('replyForm')?.addEventListener('submit', async event => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await api(`/discussions/${encodeURIComponent(thread.id)}/replies`, { method: 'POST', body: JSON.stringify({ body: String(data.get('body')).trim() }) }); renderDiscussionDetail(thread.id, false); } catch (error) { document.getElementById('replyMessage').textContent = error.message; } });
    main.querySelectorAll('[data-delete-reply]').forEach(button => button.addEventListener('click', async () => { if (!confirm('确认删除该回复？')) return; await api(`/discussion-replies/${encodeURIComponent(button.dataset.deleteReply)}`, { method: 'DELETE' }); renderDiscussionDetail(thread.id, false); }));
    main.querySelectorAll('[data-report-reply]').forEach(button => button.addEventListener('click', () => reportContent('reply', button.dataset.reportReply)));
    document.title = `${thread.title} · 讨论区`;
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}<br><button class="dsh-button" id="discussionFallback">返回讨论区</button></div>`; document.getElementById('discussionFallback')?.addEventListener('click', () => renderDiscussions(true)); }
}

async function renderPublicCollections(push = false) {
  if (push) { state.communityPage = 1; history.pushState({}, '', '/collections/'); }
  activateHub('workshop');
  main.innerHTML = '<div class="dsh-loading">正在读取公开合集…</div>';
  try {
    const result = await api(`/collections?page=${state.communityPage}&pageSize=20`);
    main.innerHTML = `<div class="dsh-community-page"><header class="dsh-catalog-head"><div><p class="dsh-kicker">PUBLIC COLLECTIONS</p><h2>合集广场</h2><p>由社区用户公开维护的插件组合。复制后会成为你自己的私有合集。</p></div><span class="dsh-result-meta">${result.total} 个公开合集</span></header><div class="dsh-collection-grid">${result.items.length ? result.items.map(collection => `<article class="dsh-collection-card" data-public-collection="${attribute(collection.id)}" tabindex="0"><p class="dsh-kicker">${escapeHtml(collection.ownerName || '社区用户')}</p><h3>${escapeHtml(collection.name)}</h3><p>${escapeHtml(collection.description || '未填写说明')}</p><footer><span>${collection.plugins.length} 个插件</span><span>${formatTime(collection.updatedAt)}</span></footer></article>`).join('') : '<div class="dsh-empty">暂时没有公开合集。</div>'}</div>${communityPager(result, 'collections')}</div>`;
    main.querySelectorAll('[data-public-collection]').forEach(card => { card.addEventListener('click', () => renderPublicCollectionDetail(card.dataset.publicCollection, true)); card.addEventListener('keydown', event => { if (event.key === 'Enter') renderPublicCollectionDetail(card.dataset.publicCollection, true); }); });
    main.querySelectorAll('[data-community-page]').forEach(button => button.addEventListener('click', () => { state.communityPage = Number(button.dataset.communityPage); renderPublicCollections(false); }));
    document.title = '合集广场 · DSH Creative Workshop';
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

async function renderMediaGallery(push = false) {
  if (push) history.pushState({}, '', '/?view=screenshots');
  activateHub('screenshots');
  main.innerHTML = '<div class="dsh-loading">正在读取项目媒体…</div>';
  try {
    const result = await api('/plugins?page=1&pageSize=100&sort=recent');
    const items = result.items.filter(plugin => Number(plugin.mediaCount || 0) > 0);
    main.innerHTML = `<div class="dsh-community-page"><header class="dsh-catalog-head"><div><p class="dsh-kicker">VERIFIED PROJECT MEDIA</p><h2>项目媒体</h2><p>封面和项目图由本站同源输出；远端图片失效时仍保留可识别的确定性封面。</p></div><span class="dsh-result-meta">${items.length} 个项目</span></header><div class="dsh-media-browser-grid">${items.map(plugin => `<button class="dsh-media-browser-card" data-media-plugin="${attribute(plugin.id)}" type="button"><img src="${attribute(coverUrl(plugin))}" alt="${attribute(plugin.name)} 封面" loading="lazy" data-cover-fallback><span><strong>${escapeHtml(plugin.name)}</strong><small>${escapeHtml(plugin.fullName)} · ${formatNumber(plugin.mediaCount)} 项媒体</small></span></button>`).join('') || '<div class="dsh-empty">暂无可展示的项目媒体。</div>'}</div></div>`;
    wireMediaFallbacks(main);
    main.querySelectorAll('[data-media-plugin]').forEach(button => button.addEventListener('click', () => navigatePlugin(button.dataset.mediaPlugin)));
    document.title = '项目媒体 · DSH Creative Workshop';
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

async function renderPublicCollectionDetail(id, push = false) {
  if (push) history.pushState({}, '', `/collection/?id=${encodeURIComponent(id)}`);
  main.innerHTML = '<div class="dsh-loading">正在读取合集…</div>';
  try {
    const { collection } = await api(`/collections/${encodeURIComponent(id)}`);
    main.innerHTML = `<div class="dsh-community-page"><nav class="dsh-breadcrumbs"><button id="backToCollections" type="button">合集广场</button><span>›</span><span>${escapeHtml(collection.name)}</span></nav><section class="dsh-detail-hero dsh-collection-hero"><div class="dsh-detail-summary"><p class="dsh-kicker">由 ${escapeHtml(collection.ownerName || '社区用户')} 发布</p><h1>${escapeHtml(collection.name)}</h1><p class="dsh-detail-description">${escapeHtml(collection.description || '未填写说明')}</p><div class="dsh-detail-actions"><button class="dsh-button primary" id="cloneCollection" type="button">复制到我的合集</button><button class="dsh-button" id="shareCollection" type="button">复制站内链接</button>${state.user && state.user.id !== collection.ownerId ? '<button class="dsh-button" id="reportCollection" type="button">举报</button>' : ''}</div></div></section><div class="dsh-card-grid">${collection.plugins.length ? collection.plugins.map(cardHtml).join('') : '<div class="dsh-empty">该合集暂时没有公开插件。</div>'}</div></div>`;
    document.getElementById('backToCollections')?.addEventListener('click', () => renderPublicCollections(true));
    document.getElementById('cloneCollection')?.addEventListener('click', async () => { if (!state.user) return goLogin(); try { await api(`/collections/${encodeURIComponent(id)}/clone`, { method: 'POST' }); toast('已复制为你的私有合集。'); } catch (error) { showError(error); } });
    document.getElementById('shareCollection')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast('合集链接已复制。'); } catch { toast('请从地址栏复制链接。'); } });
    document.getElementById('reportCollection')?.addEventListener('click', () => reportContent('collection', id));
    main.querySelectorAll('.dsh-card').forEach(card => card.addEventListener('click', event => handleCardClick(event, card)));
    document.title = `${collection.name} · 合集广场`;
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

async function renderGlobalReviews(push = false) {
  if (push) { state.communityPage = 1; history.pushState({}, '', '/?view=reviews'); }
  activateHub('reviews'); main.innerHTML = '<div class="dsh-loading">正在读取社区评价…</div>';
  try {
    const result = await api(`/reviews?page=${state.communityPage}&pageSize=25`);
    main.innerHTML = `<div class="dsh-community-page"><header class="dsh-catalog-head"><div><p class="dsh-kicker">REVISION-BOUND REVIEWS</p><h2>最新社区评价</h2><p>每条评价都绑定当前公开 Revision；版本变化后不会沿用旧评分。</p></div><span class="dsh-result-meta">${result.total} 条评价</span></header><div class="dsh-review-list">${result.items.length ? result.items.map(review => `<article class="dsh-review"><div class="dsh-review-head"><strong>${escapeHtml(review.pluginName)} · ${'★'.repeat(review.rating)}</strong><span>${formatTime(review.updatedAt)}</span></div><div class="dsh-review-body">${escapeHtml(review.body)}</div><footer class="dsh-list-actions"><button class="dsh-button" data-review-plugin="${attribute(review.pluginId)}" type="button">查看插件</button>${state.user && state.user.id !== review.authorId ? `<button class="dsh-button" data-report-review="${attribute(review.id)}" type="button">举报</button>` : ''}</footer></article>`).join('') : '<div class="dsh-empty">暂时没有公开评价。</div>'}</div>${communityPager(result, 'reviews')}</div>`;
    main.querySelectorAll('[data-review-plugin]').forEach(button => button.addEventListener('click', () => navigatePlugin(button.dataset.reviewPlugin)));
    main.querySelectorAll('[data-report-review]').forEach(button => button.addEventListener('click', () => reportContent('review', button.dataset.reportReview)));
    main.querySelectorAll('[data-community-page]').forEach(button => button.addEventListener('click', () => { state.communityPage = Number(button.dataset.communityPage); renderGlobalReviews(false); }));
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

function activityText(item) {
  if (item.type === 'plugin.published') return `插件 ${item.payload.name || item.pluginId || ''} 发布了${item.payload.release?.version ? ` ${item.payload.release.version}` : '新的公开 Revision'}`;
  if (item.type === 'workshop.release.published') return `DSH Creative Workshop v${item.payload.version || ''} 发布`;
  if (item.type === 'collection.published') return `社区用户公开了合集 ${item.payload.name || ''}`;
  if (item.type === 'discussion.created') return `新讨论：${item.payload.title || ''}`;
  return item.type;
}

function activityRelease(item) {
  if (item.payload.release) return item.payload.release;
  if (item.type === 'workshop.release.published') return { version: item.payload.version, title: item.payload.title, summary: item.payload.summary, changes: item.payload.changes || [], breakingChanges: [], sourceType: 'workshop_manifest', collectedAt: item.payload.publishedAt || item.createdAt };
  return null;
}

function activityCardHtml(item) {
  const release = activityRelease(item);
  return `<article class="dsh-activity-item ${release ? 'has-release' : ''}"><time>${formatTime(item.createdAt)}</time><strong>${escapeHtml(activityText(item))}</strong>${release ? `<details ${item.type === 'workshop.release.published' ? 'open' : ''}><summary>查看更新内容</summary>${releaseNotesHtml(release)}</details>` : ''}<div class="dsh-list-actions">${item.pluginId ? `<button class="dsh-button" data-activity-plugin="${attribute(item.pluginId)}" type="button">插件详情</button>` : ''}${item.collectionId ? `<button class="dsh-button" data-activity-collection="${attribute(item.collectionId)}" type="button">合集详情</button>` : ''}${item.threadId ? `<button class="dsh-button" data-activity-thread="${attribute(item.threadId)}" type="button">讨论详情</button>` : ''}</div></article>`;
}

async function renderActivity(push = false) {
  if (push) { state.communityPage = 1; state.activityCategory = ''; history.pushState({}, '', '/?view=activity'); }
  else state.activityCategory = new URLSearchParams(location.search).get('category') || '';
  activateHub('news'); main.innerHTML = '<div class="dsh-loading">正在读取更新动态…</div>';
  try {
    const category = state.activityCategory ? `&category=${encodeURIComponent(state.activityCategory)}` : '';
    const result = await api(`/activity?page=${state.communityPage}&pageSize=25${category}`);
    const filters = [['','全部'],['platform','平台更新'],['plugin','插件更新'],['discussion','讨论'],['collection','合集']];
    main.innerHTML = `<div class="dsh-community-page"><header class="dsh-catalog-head"><div><p class="dsh-kicker">WORKSHOP ACTIVITY</p><h2>更新动态</h2><p>插件与平台更新均展示发布时保存的更新日志快照、固定 Commit 与证据来源。</p></div><span class="dsh-result-meta">${result.total} 条动态</span></header><nav class="dsh-activity-filters" aria-label="动态分类">${filters.map(([value,label]) => `<button class="dsh-button ${state.activityCategory === value ? 'active' : ''}" data-activity-category="${value}" type="button">${label}</button>`).join('')}</nav><div class="dsh-activity-list">${result.items.length ? result.items.map(activityCardHtml).join('') : '<div class="dsh-empty">当前分类暂时没有动态。</div>'}</div>${communityPager(result, 'activity')}</div>`;
    main.querySelectorAll('[data-activity-category]').forEach(button => button.addEventListener('click', () => { state.activityCategory = button.dataset.activityCategory; state.communityPage = 1; const params = new URLSearchParams({ view: 'activity' }); if (state.activityCategory) params.set('category', state.activityCategory); history.replaceState({}, '', `/?${params}`); renderActivity(false); }));
    main.querySelectorAll('[data-activity-plugin]').forEach(button => button.addEventListener('click', () => navigatePlugin(button.dataset.activityPlugin)));
    main.querySelectorAll('[data-activity-collection]').forEach(button => button.addEventListener('click', () => renderPublicCollectionDetail(button.dataset.activityCollection, true)));
    main.querySelectorAll('[data-activity-thread]').forEach(button => button.addEventListener('click', () => renderDiscussionDetail(button.dataset.activityThread, true)));
    main.querySelectorAll('[data-community-page]').forEach(button => button.addEventListener('click', () => { state.communityPage = Number(button.dataset.communityPage); renderActivity(false); }));
  } catch (error) { main.innerHTML = `<div class="dsh-error">${escapeHtml(error.message)}</div>`; }
}

function renderAbout(push = true) {
  if (push) history.pushState({}, '', '/?view=about');
  main.innerHTML = `<article class="dsh-about"><p class="dsh-kicker">DSH CREATIVE WORKSHOP · v${escapeHtml(state.version)}</p><h1>关于创意工坊</h1><p>本项目为 DeepSeek Harness 社区插件提供可审核的发现、检索、评价、收藏、订阅与合集管理。目录候选来自 GitHub <code>dsh-plugin</code> Topic，但只有固定 Commit 通过 Bundle 结构验证并经管理员批准后才会公开。</p><p>结构验证不是 DeepSeek 官方认证，也不等同于源码安全审计。当前“订阅”用于保存关注关系，不会在本机执行安装。</p><button class="dsh-button primary" id="aboutBack" type="button">返回插件目录</button></article>`;
  document.getElementById('aboutBack')?.addEventListener('click', () => navigateCatalog(true));
}

async function loadSessionAndVersion() {
  try {
    const [health, auth] = await Promise.all([
      fetch('/api/health', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : Promise.reject(new Error('health failed'))),
      api('/auth/me'),
    ]);
    state.version = health.version || state.version;
    state.user = auth.user;
    if (state.user) {
      try { state.unreadNotifications = (await api('/me/notifications?pageSize=1')).unread || 0; } catch { state.unreadNotifications = 0; }
    }
    setApiStatus(true);
  } catch {
    setApiStatus(false);
  }
  updateIdentity();
}

function route() {
  if (location.pathname.startsWith('/plugin/')) {
    const id = new URLSearchParams(location.search).get('id');
    return id ? renderPlugin(id) : navigateCatalog(false);
  }
  if (location.pathname.startsWith('/discussion/')) { const id = new URLSearchParams(location.search).get('id'); return id ? renderDiscussionDetail(id, false) : renderDiscussions(false); }
  if (location.pathname.startsWith('/collection/')) { const id = new URLSearchParams(location.search).get('id'); return id ? renderPublicCollectionDetail(id, false) : renderPublicCollections(false); }
  if (location.pathname.startsWith('/collections/')) return renderPublicCollections(false);
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'about') return renderAbout(false);
  if (view === 'discussions') return renderDiscussions(false, new URLSearchParams(location.search).get('pluginId'));
  if (view === 'reviews') return renderGlobalReviews(false);
  if (view === 'activity') return renderActivity(false);
  if (view === 'screenshots') return renderMediaGallery(false);
  state.filters = filtersFromUrl();
  activateHub('workshop');
  return loadCatalog();
}

async function init() {
  installAccountUi();
  wireHeader();
  await loadSessionAndVersion();
  startPresence();
  await route();
  window.addEventListener('popstate', route);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
