import { api, escapeHtml, formatTime } from '/js/account-api.js';

const main = document.getElementById('steamAppMain');
const state = {
  user: null,
  version: '1.1.0',
  items: [],
  facets: { kinds: [], surfaces: [], topics: [], authors: [], languages: [], licenses: [] },
  filters: { q: '', kind: '', surface: '', topic: '', author: '', language: '', license: '', sort: 'stars', page: 1 },
  total: 0,
  pageSize: 24,
  currentPlugin: null,
  reviewPage: 1,
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
  const path = String(plugin.fullName || '').split('/').map(encodeURIComponent).join('/');
  return `https://opengraph.githubassets.com/dsh-workshop-v1/${path}`;
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
    statusArea.insertAdjacentHTML('afterbegin', '<span class="dsh-api-badge" id="dshApiBadge">● API 检测中</span><button class="dsh-account-btn" id="dshAccountButton">登录 / 注册</button>');
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
  if (button) button.textContent = state.user ? `${state.user.username}${state.user.role === 'admin' ? ' · 管理' : ''}` : '登录 / 注册';
  const count = document.getElementById('topSubCount');
  if (count) count.textContent = `${state.user?.subscriptions?.length || 0} 件`;
  const menuCount = document.getElementById('menuSubCount');
  if (menuCount) menuCount.textContent = String(state.user?.subscriptions?.length || 0);
  const version = document.getElementById('topProfileName');
  if (version) version.textContent = `v${state.version}`;
}

function setApiStatus(online) {
  const badge = document.getElementById('dshApiBadge');
  if (!badge) return;
  badge.textContent = online ? '● API 在线' : '● API 离线';
  badge.classList.toggle('offline', !online);
}

function wireHeader() {
  document.querySelectorAll('.js-nav-home, .steam-hub-nav-item[data-tab="workshop"], .steam-hub-nav-item[data-tab="all"]').forEach(node => node.addEventListener('click', () => navigateCatalog(true)));
  document.querySelector('.js-nav-about')?.addEventListener('click', () => renderAbout(true));
  document.querySelector('.js-nav-discussions')?.addEventListener('click', () => toast('讨论区尚未启用；v1.1.0 使用插件详情中的真实社区评价。'));

  document.querySelectorAll('.steam-hub-nav-item:not([data-tab="workshop"]):not([data-tab="all"])').forEach(node => {
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
    state.filters = { ...state.filters, kind: item.dataset.kind === 'all' ? '' : item.dataset.kind, page: 1 };
    navigateCatalog(true);
  }));
  document.querySelector('.js-open-subscribed-menu')?.addEventListener('click', () => state.user ? openAccount('subscriptions') : goLogin());
  document.querySelector('.js-open-profile-switch')?.addEventListener('click', () => state.user ? openAccount('sessions') : goLogin());
  document.querySelector('.js-open-create-col')?.addEventListener('click', () => state.user ? openAccount('collections') : goLogin());
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
        <img src="${attribute(coverUrl(plugin))}" alt="${attribute(plugin.name)} GitHub 预览" loading="lazy">
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
          <div class="dsh-filter-actions"><button class="dsh-button primary" type="submit">应用筛选</button><button class="dsh-button" id="resetFilters" type="button">重置</button></div>
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

function detailHtml(plugin, reviews, pluginState) {
  const verification = plugin.verification || {};
  const community = plugin.community || {};
  const favorited = Boolean(pluginState?.favorited || state.user?.favorites?.includes(plugin.id));
  const subscribed = Boolean(pluginState?.subscribed || state.user?.subscriptions?.includes(plugin.id));
  const dependencies = plugin.dependencies || [];
  return `
    <div class="dsh-detail">
      <nav class="dsh-breadcrumbs"><button id="backToCatalog" type="button">创意工坊</button><span>›</span><button data-author="${attribute(plugin.author)}" type="button">${escapeHtml(plugin.author)}</button><span>›</span><span>${escapeHtml(plugin.name)}</span></nav>
      <section class="dsh-detail-hero">
        <div class="dsh-detail-cover"><img src="${attribute(coverUrl(plugin))}" alt="${attribute(plugin.name)} GitHub 预览"></div>
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
            <button class="dsh-button" id="sharePlugin" type="button">复制站内链接</button>
          </div>
        </div>
      </section>
      <div class="dsh-verification-note">此条目通过固定 Commit 的 DSH Bundle 结构验证并经管理员批准。它不是 DeepSeek 官方认证，也不代表代码安全审计；“订阅”仅保存社区关注关系，不会在本机安装代码。</div>
      <div class="dsh-detail-grid">
        <div>
          <section class="dsh-panel"><h2>标准化信息</h2><div class="dsh-stat-grid">
            ${stat('GitHub Stars', formatNumber(plugin.stars))}${stat('Forks', formatNumber(plugin.forks))}${stat('语言', plugin.language || 'Other')}${stat('许可证', plugin.license || '未声明')}
            ${stat('收藏', formatNumber(community.favoriteCount))}${stat('订阅', formatNumber(community.subscriptionCount))}${stat('当前评分', community.reviewScore ? community.reviewScore.toFixed(1) : '暂无')}${stat('最近推送', formatTime(plugin.pushedAt))}
          </div></section>
          <section class="dsh-panel"><h2>Bundle 验证证据</h2><div class="dsh-code-list">
            ${codeRow('Revision', plugin.revisionId)}${codeRow('固定 Commit', verification.commitSha)}${codeRow('package.json', verification.packageJsonPath)}${codeRow('Cordis Patch', verification.patchPath)}${codeRow('Entry IDs', (verification.entryIds || []).join(', ') || '—')}${codeRow('Module Specifiers', (verification.moduleSpecifiers || []).join(', ') || '—')}${codeRow('验证器', verification.verifierVersion || '—')}${codeRow('验证时间', formatTime(verification.checkedAt))}
          </div></section>
          <section class="dsh-panel" id="communityReviews"><h2>社区评价</h2>${reviewsHtml(reviews, pluginState)}</section>
        </div>
        <aside class="dsh-detail-side">
          <section class="dsh-panel"><h2>声明依赖</h2>${dependencies.length ? `<div class="dsh-list">${dependencies.map(dep => `<div class="dsh-dependency"><div><strong>${escapeHtml(dep.packageName)}</strong><br><span>${dep.resolved ? '已解析为公开工坊插件' : '外部或尚未收录的包'}</span></div>${dep.resolved ? `<button class="dsh-button" data-dependency="${attribute(dep.pluginId)}" type="button">查看</button>` : ''}</div>`).join('')}</div>` : '<p style="color:#8f98a0;font-size:11px">当前固定 Revision 未声明可识别的 DSH/Cordis 包依赖。系统不会推测不存在的关系。</p>'}</section>
          <section class="dsh-panel"><h2>仓库信息</h2><div class="dsh-code-list">${codeRow('仓库', plugin.fullName)}${codeRow('包名', plugin.packageName || '—')}${codeRow('包目录', plugin.packagePath || '.')}${codeRow('数据来源', 'GitHub dsh-plugin Topic')}</div></section>
        </aside>
      </div>
    </div>`;
}

async function renderPlugin(id) {
  main.innerHTML = '<div class="dsh-loading"><div class="dsh-skeleton"></div><p>正在加载插件详情…</p></div>';
  try {
    const requests = [api(`/plugins/${encodeURIComponent(id)}`), api(`/plugins/${encodeURIComponent(id)}/reviews?page=${state.reviewPage}&pageSize=20`)];
    if (state.user) requests.push(api(`/me/plugins/${encodeURIComponent(id)}/state`));
    const [pluginResult, reviews, userState] = await Promise.all(requests);
    const plugin = pluginResult.plugin;
    state.currentPlugin = plugin;
    main.innerHTML = detailHtml(plugin, reviews, userState?.state || null);
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
  document.getElementById('detailFavorite')?.addEventListener('click', () => toggleDetailRelation('favorites', plugin.id));
  document.getElementById('detailSubscribe')?.addEventListener('click', () => toggleDetailRelation('subscriptions', plugin.id));
  document.getElementById('addToCollection')?.addEventListener('click', () => state.user ? openPluginCollections(plugin) : goLogin());
  document.getElementById('sharePlugin')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('站内插件详情链接已复制。'); } catch { toast('无法访问剪贴板，请从地址栏复制链接。'); }
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
  const items = [['overview','概览'],['favorites','收藏'],['subscriptions','订阅'],['collections','合集'],['sessions','设备会话'],['security','安全']];
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
    else if (view === 'favorites' || view === 'subscriptions') await renderRelations(body, view);
    else if (view === 'collections') await renderCollections(body);
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
    <div class="wide"><div class="dsh-chip-row">${collection.pluginIds.length ? collection.pluginIds.map(id => `<button class="dsh-chip" data-remove-collection-plugin="${attribute(id)}" type="button" title="从合集移除">${escapeHtml(id)} ×</button>`).join('') : '<span style="color:#8f98a0;font-size:11px">空合集</span>'}</div></div>
    <div class="wide dsh-list-actions"><button class="dsh-button primary" data-save-collection type="button">保存更改</button><button class="dsh-button danger" data-delete-collection type="button">删除合集</button></div>
  </div></section>`;
}

async function renderCollections(body) {
  const result = await api('/me/collections');
  body.innerHTML = `${accountNav('collections')}<section class="dsh-panel"><h2>新建合集</h2><form class="dsh-form-grid" id="createCollectionForm"><label class="dsh-field">名称<input name="name" minlength="2" maxlength="80" required></label><label class="dsh-field">说明<input name="description" maxlength="500"></label><button class="dsh-button primary" type="submit">创建空合集</button></form><p class="dsh-message" id="collectionMessage"></p></section><div class="dsh-list">${result.items.map(collectionEditor).join('') || '<div class="dsh-empty">尚未创建合集。</div>'}</div>`;
  wireAccountNav();
  document.getElementById('createCollectionForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api('/me/collections', { method: 'POST', body: JSON.stringify({ name: String(data.get('name')).trim(), description: String(data.get('description') || '').trim(), pluginIds: [] }) }); await renderCollections(body); }
    catch (error) { document.getElementById('collectionMessage').textContent = error.message; }
  });
  body.querySelectorAll('[data-collection-card]').forEach(card => {
    const collection = result.items.find(item => item.id === card.dataset.collectionCard);
    card.querySelectorAll('[data-remove-collection-plugin]').forEach(button => button.addEventListener('click', () => { collection.pluginIds = collection.pluginIds.filter(id => id !== button.dataset.removeCollectionPlugin); button.remove(); }));
    card.querySelector('[data-save-collection]')?.addEventListener('click', async () => {
      try {
        await api(`/me/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', body: JSON.stringify({ name: card.querySelector('[data-collection-name]').value.trim(), description: card.querySelector('[data-collection-description]').value.trim(), pluginIds: collection.pluginIds }) });
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
    try { const updated = await api(`/me/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', body: JSON.stringify({ name: collection.name, description: collection.description, pluginIds }) }); collection.pluginIds = updated.collection.pluginIds; toast(input.checked ? '已加入合集。' : '已从合集移除。'); }
    catch (error) { input.checked = !input.checked; showError(error); }
    finally { input.disabled = false; }
  }));
  document.getElementById('quickCollectionForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api('/me/collections', { method: 'POST', body: JSON.stringify({ name: String(data.get('name')).trim(), description: String(data.get('description') || '').trim(), pluginIds: [plugin.id] }) }); toast('合集已创建并加入当前插件。'); closeDialog(); }
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
  try { await api('/auth/logout', { method: 'POST' }); } finally { state.user = null; updateIdentity(); closeDialog(); navigateCatalog(true); }
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
  if (new URLSearchParams(location.search).get('view') === 'about') return renderAbout(false);
  state.filters = filtersFromUrl();
  return loadCatalog();
}

async function init() {
  installAccountUi();
  wireHeader();
  await loadSessionAndVersion();
  await route();
  window.addEventListener('popstate', route);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
