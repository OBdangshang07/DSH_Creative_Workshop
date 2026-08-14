import { api, escapeHtml, formatTime } from '/js/account-api.js';

const main = document.getElementById('mainContent');
const titles = { overview: '运行总览', plugins: '插件审核', sync: '目录同步', releases: '更新日志', users: '用户管理', community: '社区治理', audit: '审计日志' };
const state = {
  view: 'overview', overview: null,
  plugins: { page: 1, q: '', status: '', kind: '' },
  users: { page: 1, q: '', role: '', status: '' },
  community: { page: 1, q: '', type: '', status: '', reportsPage: 1, reportStatus: 'pending' },
  audit: { page: 1, q: '', action: '' }, syncTimer: null,
};

function toast(text, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = text;
  document.getElementById('toastRegion').appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function badge(status, text) {
  const labels = { approved: '已公开', pending: '待审核', hidden: '已隐藏', rejected: '已拒绝', deferred: '已延后', active: '启用', disabled: '停用', completed: '已完成', partially_failed: '待继续', failed: '失败', queued: '排队中', discovering: '发现候选', verifying: '结构验证', verified: '已验证', open: '开放', locked: '已锁定', visible: '可见', resolved: '已处理', dismissed: '已驳回', thread: '讨论', reply: '回复', collection: '合集', review: '评价' };
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(text || labels[status] || status)}</span>`;
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
      <article class="stat presence-stat"><p><i></i>当前在线</p><strong class="green">${overview.presence.online}</strong><small>${overview.presence.windowSeconds} 秒活跃窗口</small></article>
      <article class="stat"><p>24h 在线峰值</p><strong class="blue">${overview.presence.peak24h}</strong></article>
      <article class="stat"><p>注册用户</p><strong>${overview.users}</strong></article>
      <article class="stat"><p>目录 Bundle</p><strong class="blue">${overview.plugins}</strong></article>
      <article class="stat"><p>公开展示</p><strong class="green">${overview.approvedPlugins}</strong></article>
      <article class="stat"><p>待审核 Revision</p><strong class="amber">${overview.pendingRevisions}</strong></article>
      <article class="stat"><p>公开讨论</p><strong>${overview.discussions}</strong></article>
      <article class="stat"><p>公开合集</p><strong>${overview.publicCollections}</strong></article>
      <article class="stat"><p>待处理举报</p><strong class="${overview.pendingReports ? 'amber' : 'green'}">${overview.pendingReports}</strong></article>
      <article class="stat"><p>平台版本</p><strong class="blue">${overview.releases}</strong></article>
      <article class="stat"><p>GitHub 凭据</p><strong class="${overview.githubSync.authenticated ? 'green' : 'amber'}">${overview.githubSync.authenticated ? 'TOKEN' : 'ANON'}</strong><small>单批上限 ${overview.githubSync.batchLimit}</small></article>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><div><h2>目录治理状态</h2><p>仅发布通过结构验证并经人工批准的 revision</p></div><button class="button" data-jump="plugins">进入审核</button></div><div class="panel-body status-list">
        <div class="status-row"><span>已公开</span><div class="meter"><i style="width:${overview.approvedPlugins / total * 100}%"></i></div><strong>${overview.approvedPlugins}</strong></div>
        <div class="status-row"><span>待审核</span><div class="meter"><i style="width:${overview.pendingPlugins / total * 100}%;background:var(--amber)"></i></div><strong>${overview.pendingPlugins}</strong></div>
        <div class="status-row"><span>已拦截</span><div class="meter"><i style="width:${overview.rejectedPlugins / total * 100}%;background:var(--red)"></i></div><strong>${overview.rejectedPlugins}</strong></div>
        <div class="status-row"><span>启用用户</span><div class="meter"><i style="width:${overview.users ? overview.activeUsers / overview.users * 100 : 0}%;background:var(--green)"></i></div><strong>${overview.activeUsers}/${overview.users}</strong></div>
      </div></section>
      <section class="panel"><div class="panel-head"><div><h2>最近同步</h2><p>${overview.githubSyncedAt ? formatTime(overview.githubSyncedAt) : '尚无完成记录'}</p></div><button class="button primary" data-jump="sync">同步目录</button></div><div class="panel-body">
        ${latest ? `<p>${badge(latest.status)}</p><div class="sync-progress"><div><strong>${latest.discovered}</strong>候选仓库</div><div><strong>${latest.verified}</strong>验证仓库</div><div><strong>${latest.bundlesFound}</strong>Bundle</div><div><strong>${latest.deferred}</strong>待续跑</div><div><strong>${latest.failed}</strong>失败</div></div>` : '<div class="empty">尚未创建同步任务</div>'}
      </div></section>
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>社区运行状态</h2><p>讨论、公开合集与用户举报均由真实后端存储和治理</p></div><button class="button ${overview.pendingReports ? 'primary' : ''}" data-jump="community">进入社区治理</button></div><div class="panel-body community-summary">
      <div><span>讨论主题</span><strong>${overview.discussions}</strong></div><div><span>公开合集</span><strong>${overview.publicCollections}</strong></div><div><span>待处理举报</span><strong>${overview.pendingReports}</strong></div><div><span>有效会话</span><strong>${overview.sessions}</strong></div>
    </div></section>
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
  const credentialNote = result.github.authenticated
    ? '<span class="sync-credential ok">已使用只读 GitHub Token · 单批最多 60 个仓库</span>'
    : '<span class="sync-credential warning">匿名 GitHub API · 单批最多 15 个仓库；延后项请使用“继续同步”分批处理</span>';
  main.innerHTML = `<section class="sync-hero"><div><h2>GitHub Topic → 固定 commit → 多 Bundle 验证</h2><p>Topic 仅用于候选发现，并交叉覆盖最近更新与高 Star 仓库。任务不会运行第三方代码；新 Revision 默认待审核，公开目录不会因部分失败而减少。</p>${credentialNote}</div><button class="button primary" id="createSync" ${active ? 'disabled' : ''}>${active ? '同步进行中' : '创建新同步'}</button></section>
    <div class="table-wrap"><table><thead><tr><th>任务 / 时间</th><th>状态</th><th>处理结果</th><th>核心 API 余量</th><th>操作</th></tr></thead><tbody>${result.items.map(run => `<tr><td><code>${escapeHtml(run.id)}</code><br><small>${formatTime(run.createdAt)}${run.retryOf ? `<br>续跑自 ${escapeHtml(run.retryOf)}` : ''}<br>${run.githubAuthenticated ? 'Token' : '匿名'}</small></td><td>${badge(run.status)}${run.error ? `<br><span class="reason">${escapeHtml(run.error)}</span>` : ''}</td><td><small>候选仓库 ${run.discovered} · 验证仓库 ${run.verified}<br>Bundle ${run.bundlesFound} · 拒绝 ${run.rejected}<br>延后 ${run.deferred} · 失败 ${run.failed}</small></td><td><small>${run.githubRemaining ?? '—'}${run.githubResetAt ? `<br>重置 ${formatTime(run.githubResetAt)}` : ''}</small></td><td><div class="actions"><button data-sync-detail="${run.id}">查看明细</button>${run.deferred > 0 || run.failed > 0 ? `<button data-sync-retry="${run.id}">继续同步</button>` : ''}</div></td></tr><tr id="detail-${run.id}" hidden><td colspan="5"><div class="sync-detail">加载中…</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">尚无同步任务</td></tr>'}</tbody></table></div>`;
  document.getElementById('createSync').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await api('/admin/sync-runs', { method: 'POST' }); toast('同步任务已创建，正在后台执行'); await renderSync(); } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; } });
  main.querySelectorAll('[data-sync-detail]').forEach(button => button.addEventListener('click', async () => {
    const row = document.getElementById(`detail-${button.dataset.syncDetail}`); row.hidden = !row.hidden; if (row.hidden || row.dataset.loaded) return;
    try { const run = await api(`/admin/sync-runs/${encodeURIComponent(button.dataset.syncDetail)}`); row.dataset.loaded = 'true'; row.querySelector('.sync-detail').innerHTML = run.candidates?.length ? `<div class="table-wrap"><table><thead><tr><th>候选仓库</th><th>Commit</th><th>结果</th><th>原因 / Bundle</th></tr></thead><tbody>${run.candidates.map(candidate => `<tr><td>${escapeHtml(candidate.repository)}</td><td><code>${escapeHtml(candidate.commitSha?.slice(0,12) || '—')}</code></td><td>${badge(candidate.status)}</td><td><small>${candidate.bundleCount} Bundle${candidate.reason ? `<br><span class="reason">${escapeHtml(candidate.reason)}</span>` : ''}</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">当前任务尚无候选明细</div>'; } catch (error) { row.querySelector('.sync-detail').textContent = error.message; }
  }));
  main.querySelectorAll('[data-sync-retry]').forEach(button => button.addEventListener('click', async () => { try { await api(`/admin/sync-runs/${encodeURIComponent(button.dataset.syncRetry)}/retry`, { method: 'POST' }); toast('续跑任务已创建，仅处理失败或延后的候选'); await renderSync(); } catch (error) { toast(error.message, 'error'); } }));
  clearTimeout(state.syncTimer); if (active && state.view === 'sync') state.syncTimer = setTimeout(() => renderSync().catch(showFailure), 5000);
}

async function renderReleases() {
  const [workshop, plugins] = await Promise.all([api('/releases'), api('/admin/plugins?page=1&pageSize=100')]);
  const sourceLabel = { declared: '插件声明', github_release: 'GitHub Release', changelog: 'CHANGELOG', commit: 'Commit 兜底', missing: '作者未提供', manual: '人工整理' };
  main.innerHTML = `<div class="section-note">活动流使用发布时保存的更新日志快照。自动采集顺序为插件声明、GitHub Release、CHANGELOG、Commit 摘要；未取得内容时会明确标记，不生成推测信息。</div>
    <section class="panel community-panel"><div class="panel-head"><div><h2>平台版本</h2><p>来源为仓库内结构化 Release Manifest</p></div><button class="button" id="syncReleaseNotes">同步目录并重新采集</button></div><div class="panel-body event-list">${workshop.items.map(item => `<div class="event"><time>${formatTime(item.publishedAt)}</time><strong>v${escapeHtml(item.version)} · ${escapeHtml(item.title)}</strong><code>${escapeHtml(item.summary)}</code></div>`).join('') || '<div class="empty">暂无平台版本记录</div>'}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>插件 Revision 更新日志</h2><p>${plugins.total} 个最新候选 Revision</p></div></div><div class="panel-body release-admin-list">${plugins.items.map(plugin => {
      const release = plugin.release || { title: `${plugin.name} 更新`, summary: '作者未提供更新日志。', changes: [], breakingChanges: [], sourceType: 'missing' };
      const changeText = (release.changes || []).map(item => `${item.type}|${item.text}`).join('\n');
      return `<details class="release-editor"><summary><span><strong>${escapeHtml(plugin.name)}</strong><small>${escapeHtml(plugin.version || plugin.verification.commitSha.slice(0,12))} · ${escapeHtml(sourceLabel[release.sourceType] || release.sourceType)}</small></span><code>${escapeHtml(plugin.verification.commitSha.slice(0,12))}</code></summary><form data-release-form="${escapeHtml(plugin.id)}" data-revision="${escapeHtml(plugin.revisionId)}"><label>标题<input name="title" value="${escapeHtml(release.title)}" maxlength="180" required></label><label>摘要<textarea name="summary" maxlength="800" required>${escapeHtml(release.summary)}</textarea></label><label>分类变更 <small>每行使用 type|内容，type 可为 added / changed / fixed / removed / security / other</small><textarea name="changes" placeholder="changed|调整了插件行为">${escapeHtml(changeText)}</textarea></label><label>不兼容变更 <small>每行一项</small><textarea name="breakingChanges">${escapeHtml((release.breakingChanges || []).join('\n'))}</textarea></label><label>GitHub 来源地址<input name="sourceUrl" type="url" value="${escapeHtml(release.sourceUrl || '')}" placeholder="https://github.com/..."></label><div class="actions"><button class="button primary" type="submit">保存并标记为人工整理</button><button class="button" type="button" data-refresh-release="${escapeHtml(plugin.id)}" data-refresh-revision="${escapeHtml(plugin.revisionId)}">重新从 GitHub 采集</button></div></form></details>`;
    }).join('') || '<div class="empty">暂无插件 Revision</div>'}</div></section>`;
  document.getElementById('syncReleaseNotes')?.addEventListener('click', async event => { event.currentTarget.disabled = true; try { await api('/admin/sync-runs', { method: 'POST' }); toast('目录同步已创建，更新日志会随固定 Revision 重新采集'); switchView('sync'); } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; } });
  main.querySelectorAll('[data-release-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const changes = String(data.get('changes') || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => { const separator = line.indexOf('|'); return { type: separator > 0 ? line.slice(0, separator).trim() : 'other', text: separator > 0 ? line.slice(separator + 1).trim() : line }; });
    const breakingChanges = String(data.get('breakingChanges') || '').split('\n').map(line => line.trim()).filter(Boolean);
    try { await api(`/admin/plugins/${encodeURIComponent(form.dataset.releaseForm)}/revisions/${encodeURIComponent(form.dataset.revision)}/changelog`, { method: 'PATCH', body: JSON.stringify({ title: String(data.get('title')).trim(), summary: String(data.get('summary')).trim(), changes, breakingChanges, ...(String(data.get('sourceUrl') || '').trim() ? { sourceUrl: String(data.get('sourceUrl')).trim() } : {}) }) }); toast('更新日志已保存'); await renderReleases(); }
    catch (error) { toast(error.message, 'error'); }
  }));
  main.querySelectorAll('[data-refresh-release]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await api(`/admin/plugins/${encodeURIComponent(button.dataset.refreshRelease)}/revisions/${encodeURIComponent(button.dataset.refreshRevision)}/changelog/retry`, { method: 'POST' }); toast('已从 GitHub 重新采集该 Revision 的更新日志'); await renderReleases(); } catch (error) { toast(error.message, 'error'); button.disabled = false; } }));
}

async function renderUsers() {
  const query = new URLSearchParams({ page: state.users.page, pageSize: 25 }); ['q','role','status'].forEach(key => { if (state.users[key]) query.set(key, state.users[key]); });
  const result = await api(`/admin/users?${query}`);
  main.innerHTML = `<form class="toolbar" id="userFilters"><input name="q" value="${escapeHtml(state.users.q)}" placeholder="搜索用户名或邮箱"><select name="role"><option value="">全部角色</option><option value="user" ${state.users.role === 'user' ? 'selected' : ''}>普通用户</option><option value="admin" ${state.users.role === 'admin' ? 'selected' : ''}>管理员</option></select><select name="status"><option value="">全部状态</option><option value="active" ${state.users.status === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${state.users.status === 'disabled' ? 'selected' : ''}>停用</option></select><button class="button primary">筛选</button></form>
    <div class="table-wrap"><table><thead><tr><th>用户</th><th>角色 / 状态</th><th>使用情况</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${result.items.map(user => `<tr><td><strong class="row-title">${escapeHtml(user.username)}</strong><small>${escapeHtml(user.email)}<br><code>${escapeHtml(user.id)}</code></small></td><td>${badge(user.role)} ${badge(user.status)}</td><td><small>收藏 ${user.favorites.length}<br>订阅 ${user.subscriptions.length}</small></td><td><small>${formatTime(user.lastLoginAt)}<br>注册 ${formatTime(user.createdAt)}</small></td><td><div class="actions"><button data-user-sessions="${user.id}">会话</button><button data-user-history="${user.id}">改名历史</button><button data-user="${user.id}" data-role="${user.role === 'admin' ? 'user' : 'admin'}">${user.role === 'admin' ? '移除管理员' : '设为管理员'}</button><button class="danger" data-user="${user.id}" data-status="${user.status === 'active' ? 'disabled' : 'active'}">${user.status === 'active' ? '停用账号' : '启用账号'}</button></div></td></tr><tr id="sessions-${user.id}" hidden><td colspan="5"><div class="sync-detail">加载会话中…</div></td></tr><tr id="history-${user.id}" hidden><td colspan="5"><div class="sync-detail">加载改名历史中…</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">没有符合条件的用户</td></tr>'}</tbody></table></div>${pagination(result, 'users')}`;
  document.getElementById('userFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.users = { ...state.users, page: 1, q: String(values.get('q') || '').trim(), role: String(values.get('role') || ''), status: String(values.get('status') || '') }; renderUsers().catch(showFailure); });
  main.querySelectorAll('[data-user]').forEach(button => button.addEventListener('click', async () => { const disabling = button.dataset.status === 'disabled' || button.dataset.role === 'user'; const confirmation = await confirmAction({ title: disabling ? '确认降低账号权限？' : '确认提升账号权限？', body: disabling ? '停用账号会立即撤销其所有会话；系统不会允许停用最后一名有效管理员。' : '管理员可以审核插件、管理用户和查看审计数据。', confirmText: '确认更新' }); if (confirmation === null) return; try { await api(`/admin/users/${encodeURIComponent(button.dataset.user)}`, { method: 'PATCH', body: JSON.stringify(button.dataset.role ? { role: button.dataset.role } : { status: button.dataset.status }) }); toast('用户状态已更新'); await renderUsers(); } catch (error) { toast(error.message, 'error'); } }));
  main.querySelectorAll('[data-user-sessions]').forEach(button => button.addEventListener('click', async () => { const userId = button.dataset.userSessions; const row = document.getElementById(`sessions-${userId}`); row.hidden = !row.hidden; if (row.hidden) return; try { const result = await api(`/admin/users/${encodeURIComponent(userId)}/sessions`); row.querySelector('.sync-detail').innerHTML = result.items.length ? result.items.map(session => `<div class="session-card"><div><strong>${escapeHtml(session.userAgent || '未知客户端')} ${session.current ? '<span class="current-mark">当前</span>' : ''}</strong><small>${escapeHtml(session.ip || '未知 IP')} · 最近 ${formatTime(session.lastSeenAt)} · 到期 ${formatTime(session.expiresAt)}</small></div><button class="button danger" data-revoke-session="${session.id}">撤销</button></div>`).join('') : '<div class="empty">该用户没有有效会话</div>'; row.querySelectorAll('[data-revoke-session]').forEach(revoke => revoke.addEventListener('click', async () => { try { await api(`/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(revoke.dataset.revokeSession)}`, { method: 'DELETE' }); toast('会话已撤销'); button.click(); button.click(); } catch (error) { toast(error.message, 'error'); } })); } catch (error) { row.querySelector('.sync-detail').textContent = error.message; } }));
  main.querySelectorAll('[data-user-history]').forEach(button => button.addEventListener('click', async () => { const userId = button.dataset.userHistory; const row = document.getElementById(`history-${userId}`); row.hidden = !row.hidden; if (row.hidden) return; try { const result = await api(`/admin/users/${encodeURIComponent(userId)}/username-history`); row.querySelector('.sync-detail').innerHTML = result.profile.history.length ? result.profile.history.map(item => `<div class="session-card"><div><strong>${escapeHtml(item.oldUsername)} → ${escapeHtml(item.newUsername)}</strong><small>${formatTime(item.changedAt)} · 旧名保留至 ${formatTime(item.reservedUntil)}</small></div></div>`).join('') : '<div class="empty">该用户尚未修改过账号名</div>'; } catch (error) { row.querySelector('.sync-detail').textContent = error.message; } })); bindCommon();
}

function communityActions(item) {
  if (item.type === 'thread') return `<button data-community-action="${item.status === 'locked' ? 'open' : 'locked'}" data-community-type="thread" data-community-id="${escapeHtml(item.id)}">${item.status === 'locked' ? '解除锁定' : '锁定'}</button><button class="danger" data-community-action="${item.status === 'hidden' ? 'open' : 'hidden'}" data-community-type="thread" data-community-id="${escapeHtml(item.id)}">${item.status === 'hidden' ? '恢复显示' : '隐藏'}</button>`;
  if (item.type === 'reply') return `<button class="${item.status === 'hidden' ? '' : 'danger'}" data-community-action="${item.status === 'hidden' ? 'visible' : 'hidden'}" data-community-type="reply" data-community-id="${escapeHtml(item.id)}">${item.status === 'hidden' ? '恢复显示' : '隐藏'}</button>`;
  return `<button class="${item.status === 'hidden' ? '' : 'danger'}" data-community-action="${item.status === 'hidden' ? 'visible' : 'hidden'}" data-community-type="collection" data-community-id="${escapeHtml(item.id)}">${item.status === 'hidden' ? '恢复公开' : '隐藏'}</button>`;
}

async function renderCommunity() {
  const contentQuery = new URLSearchParams({ page: state.community.page, pageSize: 25 });
  ['q', 'type', 'status'].forEach(key => { if (state.community[key]) contentQuery.set(key, state.community[key]); });
  const reportQuery = new URLSearchParams({ page: state.community.reportsPage, pageSize: 15 });
  if (state.community.reportStatus) reportQuery.set('status', state.community.reportStatus);
  const [content, reports] = await Promise.all([api(`/admin/community?${contentQuery}`), api(`/admin/reports?${reportQuery}`)]);
  const reportPages = Math.max(1, Math.ceil(reports.total / reports.pageSize));
  main.innerHTML = `
    <div class="section-note">社区内容默认保持可见。锁定讨论会禁止继续回复；隐藏内容和处理举报都要求填写原因，并写入审计日志。</div>
    <section class="panel community-panel"><div class="panel-head"><div><h2>内容治理</h2><p>讨论主题、回复与公开合集</p></div></div><div class="panel-body">
      <form class="toolbar" id="communityFilters"><input name="q" value="${escapeHtml(state.community.q)}" placeholder="搜索标题、正文或作者"><select name="type"><option value="">全部类型</option>${['thread','reply','collection'].map(value => `<option value="${value}" ${state.community.type === value ? 'selected' : ''}>${{thread:'讨论',reply:'回复',collection:'合集'}[value]}</option>`).join('')}</select><select name="status"><option value="">全部状态</option>${['open','locked','visible','hidden'].map(value => `<option value="${value}" ${state.community.status === value ? 'selected' : ''}>${{open:'开放',locked:'锁定',visible:'可见',hidden:'隐藏'}[value]}</option>`).join('')}</select><button class="button primary">筛选</button></form>
      <div class="table-wrap"><table><thead><tr><th>类型 / 内容</th><th>作者</th><th>状态</th><th>举报</th><th>操作</th></tr></thead><tbody>${content.items.map(item => `<tr><td>${badge(item.type)} <strong class="row-title">${escapeHtml(item.title)}</strong><small class="content-preview">${escapeHtml(item.body)}</small></td><td><small>${escapeHtml(item.authorName)}<br>${formatTime(item.updatedAt)}</small></td><td>${badge(item.status)}</td><td><strong class="${item.reportCount ? 'amber-text' : ''}">${item.reportCount}</strong></td><td><div class="actions">${communityActions(item)}</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">没有符合条件的社区内容</td></tr>'}</tbody></table></div>${pagination(content, 'community')}
    </div></section>
    <section class="panel community-panel"><div class="panel-head"><div><h2>用户举报</h2><p>先核验目标内容，再决定处理或驳回</p></div><select id="reportStatus"><option value="pending" ${state.community.reportStatus === 'pending' ? 'selected' : ''}>待处理</option><option value="resolved" ${state.community.reportStatus === 'resolved' ? 'selected' : ''}>已处理</option><option value="dismissed" ${state.community.reportStatus === 'dismissed' ? 'selected' : ''}>已驳回</option><option value="" ${state.community.reportStatus === '' ? 'selected' : ''}>全部</option></select></div><div class="panel-body">
      <div class="report-grid">${reports.items.map(report => `<article class="report-card"><div class="report-card-head">${badge(report.targetType)} ${badge(report.status, report.status === 'pending' ? '待处理' : undefined)}<time>${formatTime(report.createdAt)}</time></div><h3>${escapeHtml(report.target?.title || '目标内容已不存在')}</h3><p>${escapeHtml(report.target?.body || '无法读取目标正文')}</p><dl><div><dt>举报人</dt><dd>${escapeHtml(report.reporterName)}</dd></div><div><dt>原因</dt><dd>${escapeHtml(report.reason)}</dd></div>${report.resolution ? `<div><dt>处理说明</dt><dd>${escapeHtml(report.resolution)}</dd></div>` : ''}</dl>${report.status === 'pending' ? `<div class="actions"><button data-report-id="${escapeHtml(report.id)}" data-report-status="resolved">标记已处理</button><button data-report-id="${escapeHtml(report.id)}" data-report-status="dismissed">驳回举报</button></div>` : ''}</article>`).join('') || '<div class="empty">当前筛选下没有举报</div>'}</div>
      <div class="pagination"><span>第 ${reports.page} / ${reportPages} 页 · 共 ${reports.total} 项</span><button data-report-page="${reports.page - 1}" ${reports.page <= 1 ? 'disabled' : ''}>‹</button><button data-report-page="${reports.page + 1}" ${reports.page >= reportPages ? 'disabled' : ''}>›</button></div>
    </div></section>`;
  document.getElementById('communityFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.community = { ...state.community, page: 1, q: String(values.get('q') || '').trim(), type: String(values.get('type') || ''), status: String(values.get('status') || '') }; renderCommunity().catch(showFailure); });
  document.getElementById('reportStatus').addEventListener('change', event => { state.community.reportStatus = event.currentTarget.value; state.community.reportsPage = 1; renderCommunity().catch(showFailure); });
  main.querySelectorAll('[data-community-action]').forEach(button => button.addEventListener('click', async () => {
    const label = button.textContent.trim();
    const reason = await confirmAction({ title: `${label}该内容？`, body: '此操作会立即影响社区公开展示，并写入审计日志。', confirmText: label, reason: true });
    if (reason === null) return;
    const path = button.dataset.communityType === 'collection' ? `/admin/collections/${encodeURIComponent(button.dataset.communityId)}` : `/admin/discussions/${encodeURIComponent(button.dataset.communityType)}/${encodeURIComponent(button.dataset.communityId)}`;
    try { await api(path, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.communityAction, reason }) }); toast('社区内容状态已更新'); await renderCommunity(); } catch (error) { toast(error.message, 'error'); }
  }));
  main.querySelectorAll('[data-report-id]').forEach(button => button.addEventListener('click', async () => {
    const resolution = await confirmAction({ title: button.dataset.reportStatus === 'resolved' ? '确认完成此举报处理？' : '确认驳回此举报？', body: '请填写可追溯的处理说明。此操作不会自动隐藏目标内容。', confirmText: '确认提交', reason: true });
    if (resolution === null) return;
    try { await api(`/admin/reports/${encodeURIComponent(button.dataset.reportId)}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.reportStatus, resolution }) }); toast('举报状态已更新'); await renderCommunity(); } catch (error) { toast(error.message, 'error'); }
  }));
  main.querySelectorAll('[data-report-page]').forEach(button => button.addEventListener('click', () => { state.community.reportsPage = Number(button.dataset.reportPage); renderCommunity().catch(showFailure); }));
  bindCommon();
}

async function renderAudit() {
  const query = new URLSearchParams({ page: state.audit.page, pageSize: 25 }); ['q','action'].forEach(key => { if (state.audit[key]) query.set(key, state.audit[key]); }); const result = await api(`/admin/audit?${query}`);
  main.innerHTML = `<div class="section-note">审计详情包含请求 ID 与来源 IP，用于定位管理操作。密码、Session Token 与 Cookie 不会写入日志或通过此接口返回。</div><form class="toolbar" id="auditFilters"><input name="q" value="${escapeHtml(state.audit.q)}" placeholder="搜索操作者 ID 或目标"><select name="action"><option value="">全部操作</option>${['user.update','user.username.change','plugin.moderate','plugin.changelog.update','sync.create'].map(value => `<option value="${value}" ${state.audit.action === value ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="button primary">筛选</button></form><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>操作者 / 目标</th><th>请求上下文</th><th>详情</th></tr></thead><tbody>${result.items.map(item => `<tr><td><small>${formatTime(item.at)}</small></td><td><code>${escapeHtml(item.action)}</code></td><td><small>${escapeHtml(item.actorId)}<br><code>${escapeHtml(item.target)}</code></small></td><td><small>IP ${escapeHtml(item.ip || '—')}<br>Request ${escapeHtml(item.requestId || '—')}</small></td><td><code>${escapeHtml(JSON.stringify(item.details))}</code></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无审计记录</td></tr>'}</tbody></table></div>${pagination(result, 'audit')}`;
  document.getElementById('auditFilters').addEventListener('submit', event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.audit = { ...state.audit, page: 1, q: String(values.get('q') || '').trim(), action: String(values.get('action') || '') }; renderAudit().catch(showFailure); }); bindCommon();
}

const renderers = { overview: renderOverview, plugins: renderPlugins, sync: renderSync, releases: renderReleases, users: renderUsers, community: renderCommunity, audit: renderAudit };
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
