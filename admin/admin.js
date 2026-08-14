import { api, escapeHtml, formatTime } from '/js/account-api.js';

const main = document.getElementById('mainContent');
const titles = { overview: '运行总览', plugins: '插件审核', sync: '目录同步', users: '用户管理', audit: '审计日志' };
const state = { view: 'overview', overview: null, plugins: { page: 1, q: '', status: '', kind: '' }, users: { page: 1, q: '', role: '', status: '' }, audit: { page: 1, q: '', action: '' }, syncTimer: null };

function toast(text, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = text;
  document.getElementById('toastRegion').appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function badge(status) {
  const labels = { approved: '已公开', pending: '待审核', hidden: '已隐藏', rejected: '已拒绝', active: '启用', disabled: '停用', completed: '已完成', partially_failed: '部分失败', failed: '失败', queued: '排队中', discovering: '发现候选', verifying: '结构验证', verified: '已验证' };
  return `<span class="badge ${escapeHtml(status)}">${labels[status] || escapeHtml(status)}</span>`;
}

function pagination(result, view) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return `<div class="pagination"><span>第 ${result.page} / ${pages} 页 · 共 ${result.total} 项</span><button data-page-view="${view}" data-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''}>‹</button><button data-page-view="${view}" data-page="${result.page + 1}" ${result.page >= pages ? 'disabled' : ''}>›</button></div>`;
}

async function confirmAction({ title, body, confirmText = '确认执行', reason = false }) {
  const dialog = document.getElementById('confirmDialog');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  document.getElementById('confirmSubmit').textContent = confirmText;
  document.getElementById('reasonField').hidden = !reason;
  document.getElementById('confirmReason').value = '';
  dialog.showModal();
  const result = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  const reasonValue = document.getElementById('confirmReason').value.trim();
  if (result !== 'confirm' || (reason && reasonValue.length < 3)) {
    if (result === 'confirm' && reasonValue.length < 3) toast('操作原因至少填写 3 个字符', 'error');
    return null;
  }
  return reasonValue;
}

function bindCommon() {
  main.querySelectorAll('[data-page-view]').forEach(button => button.addEventListener('click', () => {
    state[button.dataset.pageView].page = Number(button.dataset.page);
    renderCurrent();
  }));
}

async function renderOverview() {
  const overview = await api('/admin/overview');
  state.overview = overview;
  const total = Math.max(overview.plugins, 1);
  const latest = overview.latestSync;
  main.innerHTML = `
    <div class="stats">
      <article class="stat"><p>注册用户</p><strong>${overview.users}</strong></article>
      <article class="stat"><p>有效会话</p><strong>${overview.sessions}</strong></article>
      <article class="stat"><p>目录 Bundle</p><strong class="blue">${overview.plugins}</strong></article>
      <article class="stat"><p>公开展示</p><strong class="green">${overview.approvedPlugins}</strong></article>
      <article class="stat"><p>等待审核</p><strong class="amber">${overview.pendingPlugins}</strong></article>
      <article class="stat"><p>拒绝 / 隐藏</p><strong>${overview.rejectedPlugins}</strong></article>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><div><h2>目录治理状态</h2><p>仅发布通过结构验证并经人工批准的 revision</p></div><button class="button" data-jump="plugins">进入审核</button></div><div class="panel-body status-list">
        <div class="status-row"><span>已公开</span><div class="meter"><i style="width:${overview.approvedPlugins / total * 100}%"></i></div><strong>${overview.approvedPlugins}</strong></div>
        <div class="status-row"><span>待审核</span><div class="meter"><i style="width:${overview.pendingPlugins / total * 100}%;background:var(--amber)"></i></div><strong>${overview.pendingPlugins}</strong></div>
        <div class="status-row"><span>已拦截</span><div class="meter"><i style="width:${overview.rejectedPlugins / total * 100}%;background:var(--red)"></i></div><strong>${overview.rejectedPlugins}</strong></div>
        <div class="status-row"><span>启用用户</span><div class="meter"><i style="width:${overview.users ? overview.activeUsers / overview.users * 100 : 0}%;background:var(--green)"></i></div><strong>${overview.activeUsers}/${overview.users}</strong></div>
      </div></section>
      <section class="panel"><div class="panel-head"><div><h2>最近同步</h2><p>${overview.githubSyncedAt ? formatTime(overview.githubSyncedAt) : '尚无完成记录'}</p></div><button class="button primary" data-jump="sync">同步目录</button></div><div class="panel-body">
        ${latest ? `<p>${badge(latest.status)}</p><div class="sync-progress"><div><strong>${latest.discovered}</strong>候选</div><div><strong>${latest.verified}</strong>仓库通过</div><div><strong>${latest.rejected}</strong>拒绝</div><div><strong>${latest.failed}</strong>失败</div></div>` : '<div class="empty">尚未创建同步任务</div>'}
      </div></section>
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>最近管理操作</h2><p>账号变更、插件审核与同步任务都会留下审计记录</p></div><button class="button" data-jump="audit">查看全部</button></div><div class="panel-body event-list">
      ${overview.audit.length ? overview.audit.slice(0, 8).map(item => `<div class="event"><time>${formatTime(item.at)}</time><strong>${escapeHtml(item.action)}</strong><code>${escapeHtml(item.target)}</code></div>`).join('') : '<div class="empty">暂无审计记录</div>'}
    </div></section>`;
  main.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.jump)));
}

async function renderPlugins() {
  const query = new URLSearchParams({ page: state.plugins.page, pageSize: 25 });
  ['q', 'status', 'kind'].forEach(key => { if (state.plugins[key]) query.set(key, state.plugins[key]); });
  const result = await api(`/admin/plugins?${query}`);
  main.innerHTML = `
    <div class="section-note">审核对象绑定固定 commit 与 package.json 路径。新 revision 不会继承旧 revision 的批准；旧版可继续公开，直到你明确批准新版或隐藏旧版。</div>
    <form class="toolbar" id="pluginFilters"><input name="q" value="${escapeHtml(state.plugins.q)}" placeholder="搜索仓库、包名或描述"><select name="status"><option value="">全部状态</option>${['pending','approved','hidden','rejected'].map(value => `<option value="${value}" ${state.plugins.status === value ? 'selected' : ''}>${{pending:'待审核',approved:'已公开',hidden:'已隐藏',rejected:'已拒绝'}[value]}</option>`).join('')}</select><select name="kind"><option value="">全部类型</option>${['bundle','web-ui','tui','mcp-bundle'].map(value => `<option value="${value}" ${state.plugins.kind === value ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="button primary">筛选</button></form>
    <div class="table-wrap"><table><thead><tr><th>Bundle</th><th>固定 Revision 证据</th><th>类型 / 热度</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${result.items.map(plugin => `<tr><td><a class="row-title" href="${escapeHtml(plugin.url)}" target="_blank" rel="noopener">${escapeHtml(plugin.fullName)}</a><small>${escapeHtml(plugin.name)}<br>${escapeHtml(plugin.description)}</small></td><td><div class="evidence"><div><span>package</span><code title="${escapeHtml(plugin.verification.packageJsonPath)}">${escapeHtml(plugin.verification.packageJsonPath)}</code></div><div><span>patch</span><code title="${escapeHtml(plugin.verification.patchPath)}">${escapeHtml(plugin.verification.patchPath)}</code></div><div><span>commit</span><code title="${escapeHtml(plugin.verification.commitSha)}">${escapeHtml(plugin.verification.commitSha.slice(0,12))}</code></div><div><span>entries</span><code>${escapeHtml((plugin.verification.entryIds || []).join(', ') || '—')}</code></div></div></td><td>${badge(plugin.kind)}<br><small>★ ${plugin.stars} · ${plugin.language || 'Other'}</small></td><td>${badge(plugin.moderation.status)}<br><small>${plugin.publication === 'published' ? '当前公开 revision' : '候选 revision'}${plugin.moderation.reason ? `<br><span class="reason">${escapeHtml(plugin.moderation.reason)}</span>` : ''}</small></td><td><div class="actions">${plugin.moderation.status !== 'approved' ? `<button data-plugin="${escapeHtml(plugin.id)}" data-revision="${escapeHtml(plugin.revisionId)}" data-status="approved">批准公开</button>` : ''}<button data-plugin="${escapeHtml(plugin.id)}" data-revision="${escapeHtml(plugin.revisionId)}" data-status="${plugin.moderation.status === 'hidden' ? 'pending' : 'hidden'}" class="danger">${plugin.moderation.status === 'hidden' ? '转为待审' : '隐藏'}</button><button data-plugin="${escapeHtml(plugin.id)}" data-revision="${escapeHtml(plugin.revisionId)}" data-status="rejected" class="danger">拒绝</button><button data-plugin="${escapeHtml(plugin.id)}" data-revision="${escapeHtml(plugin.revisionId)}" data-featured="${!plugin.moderation.featured}">${plugin.moderation.featured ? '取消精选' : '设为精选'}</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">没有符合条件的插件 revision</td></tr>'}
    </tbody></table></div>${pagination(result, 'plugins')}`;
  document.getElementById('pluginFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.plugins = { ...state.plugins, page: 1, q: String(values.get('q') || '').trim(), status: String(values.get('status') || ''), kind: String(values.get('kind') || '') }; renderPlugins().catch(showFailure); });
  main.querySelectorAll('[data-plugin]').forEach(button => button.addEventListener('click', async () => {
    const status = button.dataset.status;
    const dangerous = ['hidden', 'rejected'].includes(status);
    const confirmation = await confirmAction({ title: status === 'approved' ? '批准公开此 revision？' : status === 'rejected' ? '拒绝此 revision？' : status === 'hidden' ? '隐藏此插件？' : '更新审核状态？', body: dangerous ? '该操作会影响商店公开目录，并写入不可省略的审核原因。' : '该操作将写入审计日志，并按固定 revision 更新目录状态。', confirmText: status === 'approved' ? '批准公开' : '确认更新', reason: dangerous });
    if (confirmation === null) return;
    const payload = button.dataset.featured === undefined ? { revisionId: button.dataset.revision, status, ...(dangerous ? { reason: confirmation } : {}) } : { revisionId: button.dataset.revision, featured: button.dataset.featured === 'true' };
    try { await api(`/admin/plugins/${encodeURIComponent(button.dataset.plugin)}`, { method: 'PATCH', body: JSON.stringify(payload) }); toast('插件审核状态已更新'); await renderPlugins(); } catch (error) { toast(error.message, 'error'); }
  }));
  bindCommon();
}

async function renderSync() {
  const result = await api('/admin/sync-runs');
  const active = result.items.find(run => ['queued', 'discovering', 'verifying'].includes(run.status));
  main.innerHTML = `<section class="sync-hero"><div><h2>GitHub Topic → 固定 commit → 多 Bundle 验证</h2><p>Topic 仅用于发现候选。同步任务不会运行第三方代码，也不会因部分仓库失败而清空现有公开目录；所有新 revision 默认进入待审核状态。</p></div><button class="button primary" id="createSync" ${active ? 'disabled' : ''}>${active ? '同步进行中' : '创建同步任务'}</button></section>
    <div class="table-wrap"><table><thead><tr><th>任务 / 时间</th><th>状态</th><th>处理结果</th><th>GitHub 配额</th><th>操作</th></tr></thead><tbody>${result.items.map(run => `<tr><td><code>${escapeHtml(run.id)}</code><br><small>${formatTime(run.createdAt)}${run.retryOf ? `<br>重试自 ${escapeHtml(run.retryOf)}` : ''}</small></td><td>${badge(run.status)}${run.error ? `<br><span class="reason">${escapeHtml(run.error)}</span>` : ''}</td><td><small>发现 ${run.discovered} · 通过 ${run.verified}<br>拒绝 ${run.rejected} · 失败 ${run.failed}</small></td><td><small>${run.githubRemaining ?? '—'}${run.githubResetAt ? `<br>重置 ${formatTime(run.githubResetAt)}` : ''}</small></td><td><div class="actions"><button data-sync-detail="${run.id}">查看明细</button>${['failed','partially_failed'].includes(run.status) ? `<button data-sync-retry="${run.id}">重试</button>` : ''}</div></td></tr><tr id="detail-${run.id}" hidden><td colspan="5"><div class="sync-detail">加载中…</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">尚无同步任务</td></tr>'}</tbody></table></div>`;
  document.getElementById('createSync').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await api('/admin/sync-runs', { method: 'POST' }); toast('同步任务已创建，正在后台执行'); await renderSync(); } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; } });
  main.querySelectorAll('[data-sync-detail]').forEach(button => button.addEventListener('click', async () => {
    const row = document.getElementById(`detail-${button.dataset.syncDetail}`); row.hidden = !row.hidden; if (row.hidden || row.dataset.loaded) return;
    try { const run = await api(`/admin/sync-runs/${encodeURIComponent(button.dataset.syncDetail)}`); row.dataset.loaded = 'true'; row.querySelector('.sync-detail').innerHTML = run.candidates?.length ? `<div class="table-wrap"><table><thead><tr><th>候选仓库</th><th>Commit</th><th>结果</th><th>原因 / Bundle</th></tr></thead><tbody>${run.candidates.map(candidate => `<tr><td>${escapeHtml(candidate.repository)}</td><td><code>${escapeHtml(candidate.commitSha?.slice(0,12) || '—')}</code></td><td>${badge(candidate.status)}</td><td><small>${candidate.bundleCount} Bundle${candidate.reason ? `<br><span class="reason">${escapeHtml(candidate.reason)}</span>` : ''}</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">当前任务尚无候选明细</div>'; } catch (error) { row.querySelector('.sync-detail').textContent = error.message; }
  }));
  main.querySelectorAll('[data-sync-retry]').forEach(button => button.addEventListener('click', async () => { try { await api(`/admin/sync-runs/${encodeURIComponent(button.dataset.syncRetry)}/retry`, { method: 'POST' }); toast('重试任务已创建'); await renderSync(); } catch (error) { toast(error.message, 'error'); } }));
  clearTimeout(state.syncTimer); if (active && state.view === 'sync') state.syncTimer = setTimeout(() => renderSync().catch(showFailure), 5000);
}

async function renderUsers() {
  const query = new URLSearchParams({ page: state.users.page, pageSize: 25 }); ['q','role','status'].forEach(key => { if (state.users[key]) query.set(key, state.users[key]); });
  const result = await api(`/admin/users?${query}`);
  main.innerHTML = `<form class="toolbar" id="userFilters"><input name="q" value="${escapeHtml(state.users.q)}" placeholder="搜索用户名或邮箱"><select name="role"><option value="">全部角色</option><option value="user" ${state.users.role === 'user' ? 'selected' : ''}>普通用户</option><option value="admin" ${state.users.role === 'admin' ? 'selected' : ''}>管理员</option></select><select name="status"><option value="">全部状态</option><option value="active" ${state.users.status === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${state.users.status === 'disabled' ? 'selected' : ''}>停用</option></select><button class="button primary">筛选</button></form>
    <div class="table-wrap"><table><thead><tr><th>用户</th><th>角色 / 状态</th><th>使用情况</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${result.items.map(user => `<tr><td><strong class="row-title">${escapeHtml(user.username)}</strong><small>${escapeHtml(user.email)}<br><code>${escapeHtml(user.id)}</code></small></td><td>${badge(user.role)} ${badge(user.status)}</td><td><small>收藏 ${user.favorites.length}<br>订阅 ${user.subscriptions.length}</small></td><td><small>${formatTime(user.lastLoginAt)}<br>注册 ${formatTime(user.createdAt)}</small></td><td><div class="actions"><button data-user-sessions="${user.id}">会话</button><button data-user="${user.id}" data-role="${user.role === 'admin' ? 'user' : 'admin'}">${user.role === 'admin' ? '移除管理员' : '设为管理员'}</button><button class="danger" data-user="${user.id}" data-status="${user.status === 'active' ? 'disabled' : 'active'}">${user.status === 'active' ? '停用账号' : '启用账号'}</button></div></td></tr><tr id="sessions-${user.id}" hidden><td colspan="5"><div class="sync-detail">加载会话中…</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">没有符合条件的用户</td></tr>'}</tbody></table></div>${pagination(result, 'users')}`;
  document.getElementById('userFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.users = { ...state.users, page: 1, q: String(values.get('q') || '').trim(), role: String(values.get('role') || ''), status: String(values.get('status') || '') }; renderUsers().catch(showFailure); });
  main.querySelectorAll('[data-user]').forEach(button => button.addEventListener('click', async () => { const disabling = button.dataset.status === 'disabled' || button.dataset.role === 'user'; const confirmation = await confirmAction({ title: disabling ? '确认降低账号权限？' : '确认提升账号权限？', body: disabling ? '停用账号会立即撤销其所有会话；系统不会允许停用最后一名有效管理员。' : '管理员可以审核插件、管理用户和查看审计数据。', confirmText: '确认更新' }); if (confirmation === null) return; try { await api(`/admin/users/${encodeURIComponent(button.dataset.user)}`, { method: 'PATCH', body: JSON.stringify(button.dataset.role ? { role: button.dataset.role } : { status: button.dataset.status }) }); toast('用户状态已更新'); await renderUsers(); } catch (error) { toast(error.message, 'error'); } }));
  main.querySelectorAll('[data-user-sessions]').forEach(button => button.addEventListener('click', async () => { const userId = button.dataset.userSessions; const row = document.getElementById(`sessions-${userId}`); row.hidden = !row.hidden; if (row.hidden) return; try { const result = await api(`/admin/users/${encodeURIComponent(userId)}/sessions`); row.querySelector('.sync-detail').innerHTML = result.items.length ? result.items.map(session => `<div class="session-card"><div><strong>${escapeHtml(session.userAgent || '未知客户端')} ${session.current ? '<span class="current-mark">当前</span>' : ''}</strong><small>${escapeHtml(session.ip || '未知 IP')} · 最近 ${formatTime(session.lastSeenAt)} · 到期 ${formatTime(session.expiresAt)}</small></div><button class="button danger" data-revoke-session="${session.id}">撤销</button></div>`).join('') : '<div class="empty">该用户没有有效会话</div>'; row.querySelectorAll('[data-revoke-session]').forEach(revoke => revoke.addEventListener('click', async () => { try { await api(`/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(revoke.dataset.revokeSession)}`, { method: 'DELETE' }); toast('会话已撤销'); button.click(); button.click(); } catch (error) { toast(error.message, 'error'); } })); } catch (error) { row.querySelector('.sync-detail').textContent = error.message; } })); bindCommon();
}

async function renderAudit() {
  const query = new URLSearchParams({ page: state.audit.page, pageSize: 25 }); ['q','action'].forEach(key => { if (state.audit[key]) query.set(key, state.audit[key]); }); const result = await api(`/admin/audit?${query}`);
  main.innerHTML = `<div class="section-note">审计详情包含请求 ID 与来源 IP，用于定位管理操作。密码、Session Token 与 Cookie 不会写入日志或通过此接口返回。</div><form class="toolbar" id="auditFilters"><input name="q" value="${escapeHtml(state.audit.q)}" placeholder="搜索操作者 ID 或目标"><select name="action"><option value="">全部操作</option>${['user.update','plugin.moderate','sync.create'].map(value => `<option value="${value}" ${state.audit.action === value ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="button primary">筛选</button></form><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>操作者 / 目标</th><th>请求上下文</th><th>详情</th></tr></thead><tbody>${result.items.map(item => `<tr><td><small>${formatTime(item.at)}</small></td><td><code>${escapeHtml(item.action)}</code></td><td><small>${escapeHtml(item.actorId)}<br><code>${escapeHtml(item.target)}</code></small></td><td><small>IP ${escapeHtml(item.ip || '—')}<br>Request ${escapeHtml(item.requestId || '—')}</small></td><td><code>${escapeHtml(JSON.stringify(item.details))}</code></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无审计记录</td></tr>'}</tbody></table></div>${pagination(result, 'audit')}`;
  document.getElementById('auditFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.audit = { ...state.audit, page: 1, q: String(values.get('q') || '').trim(), action: String(values.get('action') || '') }; renderAudit().catch(showFailure); }); bindCommon();
}

const renderers = { overview: renderOverview, plugins: renderPlugins, sync: renderSync, users: renderUsers, audit: renderAudit };
async function renderCurrent() { clearTimeout(state.syncTimer); main.setAttribute('aria-busy', 'true'); try { await renderers[state.view](); main.focus({ preventScroll: true }); } catch (error) { showFailure(error); } finally { main.removeAttribute('aria-busy'); } }
function switchView(view) { state.view = view; document.getElementById('viewTitle').textContent = titles[view]; document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view)); history.replaceState(null, '', `#${view}`); renderCurrent(); }
function showFailure(error) { if ([401,403].includes(error.status)) { location.replace(`/login/?returnTo=${encodeURIComponent('/admin/')}`); return; } main.innerHTML = `<section class="panel"><div class="panel-body empty">加载失败：${escapeHtml(error.message)}<br><br><button class="button" id="retryButton">重试</button></div></section>`; document.getElementById('retryButton').addEventListener('click', renderCurrent); }

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.getElementById('logoutButton').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); } finally { location.replace('/login/'); } });

try {
  const [auth, health] = await Promise.all([api('/auth/me'), fetch('/api/health/ready').then(async response => ({ ok: response.ok, body: response.ok ? await response.json() : null }))]);
  if (!auth.authenticated || auth.user.role !== 'admin') throw Object.assign(new Error('需要管理员权限'), { status: 403 });
  document.getElementById('adminIdentity').textContent = `${auth.user.username} · 管理员`;
  const status = document.getElementById('healthStatus'); status.className = `health ${health.ok ? 'online' : 'offline'}`; status.innerHTML = `<i></i> API ${health.ok ? '运行正常' : '就绪检查失败'}`;
  document.getElementById('appVersion').textContent = health.body?.version ? `v${health.body.version}` : '版本未知';
  const initial = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; switchView(initial);
} catch (error) { showFailure(error); }
