const api = async (path, options = {}) => {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `请求失败 (${response.status})`);
  return body;
};

let catalog = [];
let currentUser = null;
let observerBusy = false;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function installStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .dsh-account-btn,.dsh-api-badge{border:1px solid rgba(102,192,244,.35);background:#16202d;color:#c7d5e0;border-radius:3px;padding:4px 9px;font:11px 'Noto Sans SC',sans-serif;cursor:pointer}
    .dsh-api-badge{cursor:default;color:#a4d007}.dsh-api-badge.offline{color:#f59e0b}
    .dsh-source-banner{margin:0 0 12px;padding:9px 12px;background:rgba(102,192,244,.08);border:1px solid rgba(102,192,244,.24);color:#8f98a0;font-size:11px;border-radius:3px}
    .dsh-source-banner a{color:#66c0f4}.dsh-github-meta{font-size:10px;color:#8f98a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-github-meta strong{color:#f5c542}
    .dsh-empty-catalog{grid-column:1/-1;padding:28px 18px;border:1px solid rgba(102,192,244,.24);background:rgba(15,27,39,.92);color:#c7d5e0;text-align:center}
    .dsh-dialog{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.82);display:none;align-items:center;justify-content:center;padding:20px}.dsh-dialog.open{display:flex}
    .dsh-panel{width:min(920px,96vw);max-height:88vh;overflow:auto;background:#121a24;border:1px solid #2a475e;border-radius:5px;box-shadow:0 24px 70px #000;padding:20px;color:#c7d5e0}
    .dsh-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.dsh-panel h2{color:#fff;font-size:18px}.dsh-close{border:0;background:transparent;color:#8f98a0;font-size:24px;cursor:pointer}
    .dsh-tabs{display:flex;gap:8px;margin-bottom:14px}.dsh-tabs button,.dsh-button{background:#1b2838;border:1px solid #385370;color:#c7d5e0;padding:7px 12px;border-radius:3px;cursor:pointer}.dsh-tabs button.active,.dsh-button.primary{background:#1a9fff;color:#fff;border-color:#66c0f4}
    .dsh-form{display:grid;gap:10px;max-width:430px}.dsh-form label{display:grid;gap:5px;color:#8f98a0;font-size:11px}.dsh-form input{background:#0e141b;border:1px solid #385370;color:#fff;padding:9px;border-radius:3px}.dsh-message{min-height:18px;color:#f59e0b;font-size:11px}
    .dsh-admin-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:15px}.dsh-stat{background:#1b2838;padding:12px;border:1px solid rgba(255,255,255,.08)}.dsh-stat strong{display:block;color:#66c0f4;font-size:20px}
    .dsh-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}.dsh-table th,.dsh-table td{text-align:left;border-bottom:1px solid rgba(255,255,255,.08);padding:8px}.dsh-table th{color:#66c0f4}.dsh-table button{font-size:10px;padding:4px 7px;margin:2px}
    @media(max-width:700px){.dsh-admin-grid{grid-template-columns:repeat(2,1fr)}.dsh-table{display:block;overflow:auto}}
  `;
  document.head.appendChild(style);
}

function buildAccountUi() {
  const statusArea = document.querySelector('.steam-hero-subnav > div:last-child');
  if (statusArea && !document.getElementById('dshAccountButton')) {
    statusArea.insertAdjacentHTML('afterbegin', '<span class="dsh-api-badge" id="dshApiBadge">● API 在线</span><button class="dsh-account-btn" id="dshAccountButton">登录 / 注册</button>');
  }
  document.body.insertAdjacentHTML('beforeend', `
    <div class="dsh-dialog" id="dshAccountDialog" role="dialog" aria-modal="true">
      <section class="dsh-panel">
        <div class="dsh-panel-head"><h2 id="dshPanelTitle">用户中心</h2><button class="dsh-close" aria-label="关闭">×</button></div>
        <div id="dshPanelBody"></div>
      </section>
    </div>
  `);
  document.getElementById('dshAccountButton')?.addEventListener('click', showAccountDialog);
  document.querySelector('#dshAccountDialog .dsh-close')?.addEventListener('click', closeDialog);
  document.getElementById('dshAccountDialog')?.addEventListener('click', event => { if (event.target.id === 'dshAccountDialog') closeDialog(); });
}

function closeDialog() { document.getElementById('dshAccountDialog')?.classList.remove('open'); }

function authForm(mode) {
  const register = mode === 'register';
  return `
    <div class="dsh-tabs"><button data-auth-tab="login" class="${register ? '' : 'active'}">登录</button><button data-auth-tab="register" class="${register ? 'active' : ''}">注册</button></div>
    <form class="dsh-form" id="dshAuthForm">
      ${register ? '<label>用户名<input name="username" minlength="3" maxlength="32" required pattern="[A-Za-z0-9._-]+"></label><label>邮箱<input name="email" type="email" required></label>' : '<label>用户名或邮箱<input name="identity" required></label>'}
      <label>密码<input name="password" type="password" minlength="10" maxlength="128" required></label>
      <div class="dsh-message" id="dshAuthMessage">${register ? '至少 10 位，并同时包含字母和数字。' : ''}</div>
      <button class="dsh-button primary" type="submit">${register ? '创建普通用户' : '登录'}</button>
    </form>`;
}

function showAccountDialog(mode = 'login') {
  const dialog = document.getElementById('dshAccountDialog');
  dialog.classList.add('open');
  const body = document.getElementById('dshPanelBody');
  if (!currentUser) {
    body.innerHTML = authForm(mode);
    body.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAccountDialog(button.dataset.authTab)));
    body.querySelector('#dshAuthForm').addEventListener('submit', submitAuth);
    return;
  }
  body.innerHTML = `<p>已登录：<strong style="color:#66c0f4">${escapeHtml(currentUser.username)}</strong>　角色：${currentUser.role === 'admin' ? '管理员' : '普通用户'}</p>
    <p style="margin:12px 0;color:#8f98a0">收藏 ${currentUser.favorites.length} 个 · 订阅 ${currentUser.subscriptions.length} 个 · 注册于 ${new Date(currentUser.createdAt).toLocaleDateString()}</p>
    <button class="dsh-button" id="dshCreateCollection">将当前订阅保存为合集</button>
    <button class="dsh-button" id="dshChangePassword">修改密码</button>
    <button class="dsh-button" id="dshLogoutButton">退出登录</button>
    ${currentUser.role === 'admin' ? '<button class="dsh-button primary" id="dshAdminButton">打开管理面板</button>' : ''}`;
  body.querySelector('#dshLogoutButton').addEventListener('click', logout);
  body.querySelector('#dshCreateCollection').addEventListener('click', createCollection);
  body.querySelector('#dshChangePassword').addEventListener('click', changePassword);
  body.querySelector('#dshAdminButton')?.addEventListener('click', showAdmin);
}

async function changePassword() {
  const currentPassword = prompt('当前密码');
  if (!currentPassword) return;
  const nextPassword = prompt('新密码（至少 10 位，包含字母和数字）');
  if (!nextPassword) return;
  await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, nextPassword }) });
  currentUser = null;
  updateAccountButton();
  alert('密码已修改，请重新登录');
  showAccountDialog();
}

async function createCollection() {
  const name = prompt('合集名称');
  if (!name) return;
  await api('/me/collections', { method: 'POST', body: JSON.stringify({ name, description: '由我的订阅生成', pluginIds: currentUser.subscriptions }) });
  alert('合集已保存到账号');
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const register = form.has('username');
  const payload = Object.fromEntries(form.entries());
  try {
    const result = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    currentUser = result.user;
    updateAccountButton();
    showAccountDialog();
  } catch (error) { document.getElementById('dshAuthMessage').textContent = error.message; }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  currentUser = null;
  updateAccountButton();
  closeDialog();
}

function updateAccountButton() {
  const button = document.getElementById('dshAccountButton');
  const label = currentUser ? `${currentUser.username}${currentUser.role === 'admin' ? ' · 管理' : ''}` : '登录 / 注册';
  if (button && button.textContent !== label) button.textContent = label;
  const count = document.getElementById('topSubCount');
  if (count && currentUser) {
    const value = `${currentUser.subscriptions.length} 件`;
    if (count.textContent !== value) count.textContent = value;
  }
}

async function showAdmin() {
  const [overview, users, plugins] = await Promise.all([api('/admin/overview'), api('/admin/users'), api('/admin/plugins')]);
  document.getElementById('dshPanelTitle').textContent = '管理面板';
  const body = document.getElementById('dshPanelBody');
  body.innerHTML = `
    <div class="dsh-admin-grid"><div class="dsh-stat"><strong>${overview.users}</strong>用户</div><div class="dsh-stat"><strong>${overview.activeUsers}</strong>活跃</div><div class="dsh-stat"><strong>${overview.admins}</strong>管理员</div><div class="dsh-stat"><strong>${overview.plugins}</strong>GitHub 插件</div><div class="dsh-stat"><strong>${overview.approvedPlugins}</strong>已展示</div></div>
    <button class="dsh-button primary" id="dshSyncGithub">立即同步 GitHub Topic</button><span class="dsh-message" id="dshAdminMessage"></span>
    <h3 style="margin-top:18px;color:#fff">用户管理</h3>${userTable(users.items)}
    <h3 style="margin-top:18px;color:#fff">插件审核</h3>${pluginTable(plugins.items)}
  `;
  body.querySelector('#dshSyncGithub').addEventListener('click', syncGithub);
  body.querySelectorAll('[data-user-action]').forEach(button => button.addEventListener('click', adminUserAction));
  body.querySelectorAll('[data-plugin-action]').forEach(button => button.addEventListener('click', adminPluginAction));
}

function userTable(users) {
  return `<table class="dsh-table"><thead><tr><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${users.map(user => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email)}</td><td>${user.role}</td><td>${user.status}</td><td><button class="dsh-button" data-user-action="role" data-id="${user.id}" data-value="${user.role === 'admin' ? 'user' : 'admin'}">切换角色</button><button class="dsh-button" data-user-action="status" data-id="${user.id}" data-value="${user.status === 'active' ? 'disabled' : 'active'}">${user.status === 'active' ? '停用' : '启用'}</button></td></tr>`).join('')}</tbody></table>`;
}

function pluginTable(plugins) {
  return `<table class="dsh-table"><thead><tr><th>项目</th><th>Bundle 证据</th><th>Stars</th><th>审核</th><th>操作</th></tr></thead><tbody>${plugins.map(plugin => `<tr><td><a href="${plugin.url}" target="_blank" rel="noopener">${escapeHtml(plugin.fullName)}</a></td><td>${escapeHtml(plugin.verification?.packageJsonPath)} → ${escapeHtml(plugin.verification?.patchPath)}<br><small>${escapeHtml(plugin.verification?.commitSha?.slice(0, 12))}</small></td><td>${plugin.stars}</td><td>${plugin.moderation.status}</td><td><button class="dsh-button" data-plugin-action="status" data-id="${plugin.id}" data-value="${plugin.moderation.status === 'approved' ? 'hidden' : 'approved'}">${plugin.moderation.status === 'approved' ? '隐藏' : '展示'}</button><button class="dsh-button" data-plugin-action="featured" data-id="${plugin.id}" data-value="${!plugin.moderation.featured}">切换精选</button></td></tr>`).join('')}</tbody></table>`;
}

async function syncGithub(event) {
  event.currentTarget.disabled = true;
  const message = document.getElementById('dshAdminMessage');
  try {
    const result = await api('/admin/github-sync', { method: 'POST' });
    message.textContent = ` 已验证 ${result.verifiedCount} 个 DeepSeek Harness Bundle；新发现默认等待人工审核`;
    await loadCatalog();
    await showAdmin();
  } catch (error) { message.textContent = ` ${error.message}`; event.currentTarget.disabled = false; }
}

async function adminUserAction(event) {
  const button = event.currentTarget;
  await api(`/admin/users/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ [button.dataset.userAction]: button.dataset.value }) });
  await showAdmin();
}

async function adminPluginAction(event) {
  const button = event.currentTarget;
  const value = button.dataset.pluginAction === 'featured' ? button.dataset.value === 'true' : button.dataset.value;
  await api(`/admin/plugins/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ [button.dataset.pluginAction]: value }) });
  await loadCatalog();
  await showAdmin();
}

function hydrateCards() {
  if (observerBusy) return;
  observerBusy = true;
  const cards = [...document.querySelectorAll('#steamAppMain .steam-card')];
  if (!catalog.length) {
    cards.forEach(card => { card.hidden = true; delete card.dataset.githubPlugin; delete card.dataset.githubUrl; });
    const grid = document.querySelector('#steamAppMain .steam-card-grid');
    if (grid && !grid.querySelector('.dsh-empty-catalog')) grid.insertAdjacentHTML('afterbegin', '<div class="dsh-empty-catalog">当前没有同时通过 DSH Bundle 结构验证和管理员审核的插件，未验证项目不会展示。</div>');
    ensureSourceBanner();
    observerBusy = false;
    return;
  }
  document.querySelectorAll('.dsh-empty-catalog').forEach(node => node.remove());
  cards.forEach((card, index) => {
    if (index >= catalog.length) { card.hidden = true; delete card.dataset.githubPlugin; delete card.dataset.githubUrl; return; }
    card.hidden = false;
    const plugin = catalog[index];
    card.dataset.githubPlugin = plugin.id;
    card.dataset.githubUrl = plugin.url;
    const title = card.querySelector('.steam-card-title');
    const author = card.querySelector('.steam-card-author');
    const thumb = card.querySelector('.steam-card-thumb');
    if (title) {
      if (title.textContent !== plugin.name) title.textContent = plugin.name;
      title.title = plugin.description;
    }
    if (author) {
      const authorLabel = `创作者: ${plugin.author}`;
      if (author.textContent !== authorLabel) author.textContent = authorLabel;
    }
    if (thumb && !thumb.querySelector('.dsh-github-thumb')) {
      [...thumb.children].filter(child => !child.classList.contains('steam-card-quick-actions')).forEach(child => child.remove());
      const image = document.createElement('img');
      image.className = 'dsh-github-thumb';
      image.src = `https://opengraph.githubassets.com/dsh-workshop/${plugin.fullName}`;
      image.alt = plugin.fullName;
      image.loading = 'lazy';
      image.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      thumb.appendChild(image);
    }
    let meta = card.querySelector('.dsh-github-meta');
    if (!meta) { meta = document.createElement('div'); meta.className = 'dsh-github-meta'; card.querySelector('.steam-card-info')?.appendChild(meta); }
    const metaHtml = `<strong>★ ${plugin.stars.toLocaleString()}</strong> · ${escapeHtml(plugin.language || 'Other')} · GitHub`;
    if (meta.innerHTML !== metaHtml) meta.innerHTML = metaHtml;
  });
  ensureSourceBanner();
  updateAccountButton();
  observerBusy = false;
}

function ensureSourceBanner() {
  if (!document.querySelector('.dsh-source-banner')) {
    document.getElementById('steamAppMain')?.insertAdjacentHTML('afterbegin', '<div class="dsh-source-banner">仅展示经固定 commit 核验，确认存在 <code>package.json → dsh.bundle.patch → Cordis patch</code> 的 DeepSeek Harness Bundle。GitHub Topic 只用于发现候选；结构验证不代表官方认证或安全审计。</div>');
  }
}

function wireCards() {
  document.addEventListener('click', async event => {
    const favorite = event.target.closest('.js-quick-fav');
    const card = event.target.closest('.steam-card[data-github-plugin]');
    if (!card) return;
    if (favorite) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!currentUser) return showAccountDialog();
      const result = await api(`/me/favorites/${encodeURIComponent(card.dataset.githubPlugin)}/toggle`, { method: 'POST' });
      currentUser.favorites = result.favorites;
      favorite.style.color = currentUser.favorites.includes(card.dataset.githubPlugin) ? '#ff5c8a' : '';
      return;
    }
    const subscribe = event.target.closest('.js-quick-sub');
    if (subscribe) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!currentUser) return showAccountDialog();
      const result = await api(`/me/subscriptions/${encodeURIComponent(card.dataset.githubPlugin)}/toggle`, { method: 'POST' });
      currentUser.subscriptions = result.subscriptions;
      subscribe.classList.toggle('is-subbed', currentUser.subscriptions.includes(card.dataset.githubPlugin));
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    window.open(card.dataset.githubUrl, '_blank', 'noopener');
  }, true);
  const observer = new MutationObserver(() => queueMicrotask(hydrateCards));
  const main = document.getElementById('steamAppMain');
  if (main) observer.observe(main, { childList: true, subtree: true });
}

async function loadCatalog() {
  const result = await api('/github-plugins');
  catalog = result.items;
  hydrateCards();
}

async function init() {
  installStyles();
  buildAccountUi();
  wireCards();
  // The HTML cards are layout skeletons, not catalog data. Keep them hidden
  // until the API returns structurally verified and moderated DSH bundles.
  hydrateCards();
  try {
    const [catalogResult, authResult] = await Promise.all([api('/github-plugins'), api('/auth/me')]);
    catalog = catalogResult.items;
    currentUser = authResult.user;
    updateAccountButton();
    hydrateCards();
  } catch (error) {
    const badge = document.getElementById('dshApiBadge');
    if (badge) { badge.textContent = '● API 离线 · 展示缓存'; badge.classList.add('offline'); }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
