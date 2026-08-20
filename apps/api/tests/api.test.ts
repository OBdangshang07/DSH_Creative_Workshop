import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApi } from '../src/app.ts'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'
import type { Fetcher } from '../src/github-catalog.ts'

const origin = 'https://workshop.example'
const plugin = (id = 'github.community.bundle', sha = 'commit-one'): GitHubPluginRecord => ({
  id, fullName: `community/${id.split('.').at(-1)}`, name: `@community/${id.split('.').at(-1)}`,
  packageName: `@community/${id.split('.').at(-1)}`, packagePath: '.', author: 'community',
  description: 'A structurally verified DeepSeek Harness bundle fixture for API tests.',
  url: `https://github.com/community/${id}`, stars: 12, forks: 1, language: 'TypeScript',
  updatedAt: '2026-08-14T00:00:00Z', pushedAt: '2026-08-14T00:00:00Z', topics: ['dsh-plugin'],
  kind: 'bundle', surfaces: ['web', 'headless'], source: 'github-topic', securityReviewed: false,
  verification: { status: 'verified_bundle', commitSha: sha, packageJsonPath: 'package.json', patchPath: 'cordis.patch.yml', checkedAt: '2026-08-14T00:00:00Z', verifierVersion: '2.0.0', entryIds: ['bundle'], moduleSpecifiers: ['@community/bundle'] },
})

const submissionFetcher: Fetcher = async input => {
  const url = String(input)
  if (url === 'https://api.github.com/repos/community/new-dsh-plugin') return new Response(JSON.stringify({
    name: 'new-dsh-plugin', full_name: 'community/new-dsh-plugin', description: 'A directly submitted DeepSeek Harness local bundle.',
    html_url: 'https://github.com/community/new-dsh-plugin', stargazers_count: 2, forks_count: 0, language: 'TypeScript',
    updated_at: '2026-08-16T00:00:00Z', pushed_at: '2026-08-16T00:00:00Z', topics: [], archived: false, fork: false,
    default_branch: 'main', owner: { login: 'community' },
  }), { status: 200 })
  if (url.includes('/commits/main')) return new Response(JSON.stringify({ sha: 'submitted-fixed-commit', commit: { message: 'Add submitted bundle.' } }), { status: 200 })
  if (url.includes('/git/trees/submitted-fixed-commit')) return new Response(JSON.stringify({ truncated: false, tree: [
    { path: 'package.json', type: 'blob', size: 200 }, { path: 'cordis.patch.yml', type: 'blob', size: 80 },
  ] }), { status: 200 })
  if (url.endsWith('/package.json')) return new Response(JSON.stringify({ name: '@community/new-dsh-plugin', private: true, peerDependencies: { cordis: '*' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }), { status: 200 })
  if (url.endsWith('/cordis.patch.yml')) return new Response('- insert:\n    - id: submitted\n      name: "@community/new-dsh-plugin"\n', { status: 200 })
  if (url.includes('/releases?')) return new Response('[]', { status: 200 })
  return new Response('{}', { status: 404 })
}

describe('marketplace account and administration API', () => {
  let app: FastifyInstance
  let accounts: AccountStore
  let adminCookie: string
  let userCookie: string
  const published = plugin()

  beforeAll(async () => {
    accounts = new AccountStore()
    await accounts.initialize(undefined, [published])
    await accounts.moderatePlugin('system', published.id, { status: 'approved' })
    app = await buildApi({
      accountStore: accounts,
      allowedOrigins: [origin],
      bootstrapAdmin: { username: 'admin', email: 'admin@example.test', password: 'AdminPassword12345' },
      githubFetcher: submissionFetcher,
      mediaFetcher: (async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } })) as typeof fetch,
    })
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { identity: 'admin', password: 'AdminPassword12345' } })
    adminCookie = login.headers['set-cookie']!.split(';', 1)[0]!
  })

  afterAll(async () => { await app.close(); accounts.close() })

  it('reports liveness, SQLite readiness and request IDs', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': 'test-request-id' } })
    const ready = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(live.statusCode).toBe(200)
    expect(live.headers['x-request-id']).toBe('test-request-id')
    expect(ready.json()).toMatchObject({ ok: true, version: '1.1.5', storage: 'sqlite-wal', catalog: 1 })
  })

  it('only returns approved verified revisions from the public catalog', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/plugins?q=community&kind=bundle' })
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toHaveLength(1)
    expect(response.json().items[0]).toMatchObject({ id: published.id, publication: 'published', verification: { status: 'verified_bundle' } })
    expect(response.json().facets).toMatchObject({ kinds: [{ value: 'bundle', count: 1 }], surfaces: expect.arrayContaining([{ value: 'web', count: 1 }]) })
    expect(response.json().verificationNotice).toContain('dsh.bundle.patch')
    const missing = await app.inject({ method: 'GET', url: '/v1/plugins/missing' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('CATALOG_PLUGIN_NOT_FOUND')
  })

  it('registers users with secure cookies and exposes revocable sessions', async () => {
    const registered = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin, 'user-agent': 'Vitest Browser' }, payload: { username: 'normal-user', email: 'normal@example.test', password: 'NormalPassword123' } })
    expect(registered.statusCode).toBe(201)
    expect(registered.headers['set-cookie']).toContain('HttpOnly')
    expect(registered.headers['set-cookie']).toContain('Secure')
    expect(registered.headers['set-cookie']).toContain('SameSite=Strict')
    userCookie = registered.headers['set-cookie']!.split(';', 1)[0]!
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: userCookie } })
    expect(me.json().user).toMatchObject({ username: 'normal-user', role: 'user', status: 'active' })
    const sessions = await app.inject({ method: 'GET', url: '/v1/me/sessions', headers: { cookie: userCookie } })
    expect(sessions.json().items[0]).toMatchObject({ current: true, userAgent: 'Vitest Browser' })
  })

  it('serves same-origin media, accepts catalog submissions and governs media feedback', async () => {
    const detail = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}` })
    expect(detail.json().plugin).toMatchObject({ cover: { url: expect.stringContaining('/cover.svg') }, mediaCount: 1, media: [{ index: 0 }] })
    const cover = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/cover.svg` })
    expect(cover.statusCode).toBe(200)
    expect(cover.headers['content-type']).toContain('image/svg+xml')
    expect(cover.body).toContain('<svg')
    const asset = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/media/0` })
    expect(asset.statusCode).toBe(200)
    expect(asset.headers['content-type']).toBe('image/png')
    expect((await app.inject({ method: 'GET', url: '/v1/admin/media?status=ready', headers: { cookie: adminCookie } })).json().items[0]).toMatchObject({ pluginId: published.id, status: 'ready' })
    expect((await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/related` })).json()).toMatchObject({ items: expect.any(Array) })

    const submitted = await app.inject({ method: 'POST', url: '/v1/me/plugin-submissions', headers: { cookie: userCookie, origin }, payload: { repositoryUrl: 'https://github.com/community/new-dsh-plugin.git' } })
    expect(submitted.statusCode).toBe(201)
    expect(submitted.json().submission).toMatchObject({ repositoryFullName: 'community/new-dsh-plugin', status: 'pending' })
    const submissionId = submitted.json().submission.id as string
    expect((await app.inject({ method: 'GET', url: '/v1/me/plugin-submissions', headers: { cookie: userCookie } })).json().items[0].id).toBe(submissionId)
    const accepted = await app.inject({ method: 'PATCH', url: `/v1/admin/plugin-submissions/${submissionId}`, headers: { cookie: adminCookie, origin }, payload: { status: 'accepted' } })
    expect(accepted.json().submission.status).toBe('accepted')
    expect(accepted.json().verification.artifacts[0]).toMatchObject({ kind: 'local-bundle', verificationStatus: 'verified_local_bundle' })
    expect(accounts.githubSnapshot(true, { q: 'new-dsh-plugin' }).items[0]).toMatchObject({ moderation: { status: 'pending' }, source: 'github-submission' })

    const reported = await app.inject({ method: 'POST', url: `/v1/plugins/${encodeURIComponent(published.id)}/media/report`, headers: { cookie: userCookie, origin }, payload: { reason: 'The project preview is cropped incorrectly.' } })
    expect(reported.statusCode).toBe(201)
    const reportList = await app.inject({ method: 'GET', url: '/v1/admin/media-reports?status=pending', headers: { cookie: adminCookie } })
    expect(reportList.json().items[0]).toMatchObject({ pluginId: published.id, reporterName: 'normal-user' })
    const resolved = await app.inject({ method: 'PATCH', url: `/v1/admin/media-reports/${reportList.json().items[0].id}`, headers: { cookie: adminCookie, origin }, payload: { status: 'resolved', resolution: 'Preview cache was refreshed.' } })
    expect(resolved.json()).toEqual({ ok: true })
    const reset = await app.inject({ method: 'POST', url: `/v1/admin/plugins/${encodeURIComponent(published.id)}/media/retry`, headers: { cookie: adminCookie, origin } })
    expect(reset.json()).toMatchObject({ ok: true, cleared: 1 })
  })

  it('publishes structured platform and plugin revision history into filtered activity', async () => {
    const releases = await app.inject({ method: 'GET', url: '/v1/releases' })
    const revisions = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/revisions` })
    const platformActivity = await app.inject({ method: 'GET', url: '/v1/activity?category=platform' })
    const pluginActivity = await app.inject({ method: 'GET', url: '/v1/activity?category=plugin' })
    expect(releases.json().items[0]).toMatchObject({ version: '1.1.5', title: expect.any(String), changes: expect.any(Array) })
    expect(revisions.json().items[0]).toMatchObject({ revisionId: expect.any(String), release: { sourceType: 'missing', summary: '作者未提供更新日志。' } })
    expect(platformActivity.json().items[0]).toMatchObject({ type: 'workshop.release.published', payload: { version: '1.1.5', changes: expect.any(Array) } })
    expect(pluginActivity.json().items[0]).toMatchObject({ type: 'plugin.published', payload: { release: { sourceType: 'missing' } } })
  })

  it('changes usernames safely while preserving current-name attribution and old-name reservation', async () => {
    const registered = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: { username: 'rename-user', email: 'rename@example.test', password: 'RenamePassword123' } })
    const cookie = registered.headers['set-cookie']!.split(';', 1)[0]!
    const thread = await app.inject({ method: 'POST', url: '/v1/discussions', headers: { cookie, origin }, payload: { title: 'Username attribution check', body: 'This discussion verifies current username attribution after a rename.' } })
    const changed = await app.inject({ method: 'PATCH', url: '/v1/me/profile', headers: { cookie, origin, 'x-request-id': 'rename-request' }, payload: { username: 'renamed-user', currentPassword: 'RenamePassword123' } })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().user.username).toBe('renamed-user')
    const visible = await app.inject({ method: 'GET', url: `/v1/discussions/${thread.json().thread.id}` })
    expect(visible.json().thread.authorName).toBe('renamed-user')
    const cooldown = await app.inject({ method: 'PATCH', url: '/v1/me/profile', headers: { cookie, origin }, payload: { username: 'renamed-again', currentPassword: 'RenamePassword123' } })
    expect(cooldown.statusCode).toBe(409)
    expect(cooldown.json().error.code).toBe('AUTH_USERNAME_COOLDOWN')
    const reserved = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: { username: 'rename-user', email: 'takeover@example.test', password: 'TakeoverPassword123' } })
    expect(reserved.statusCode).toBe(409)
    const history = await app.inject({ method: 'GET', url: `/v1/admin/users/${changed.json().user.id}/username-history`, headers: { cookie: adminCookie } })
    expect(history.json().profile.history[0]).toMatchObject({ oldUsername: 'rename-user', newUsername: 'renamed-user' })
    await app.inject({ method: 'DELETE', url: `/v1/discussions/${thread.json().thread.id}`, headers: { cookie, origin } })
  })

  it('persists notification preferences, saved searches and discussion subscriptions', async () => {
    const preferences = await app.inject({ method: 'PATCH', url: '/v1/me/notification-preferences', headers: { cookie: userCookie, origin }, payload: { pluginUpdates: false, discussionReplies: true, platformReleases: false } })
    expect(preferences.json().preferences).toMatchObject({ pluginUpdates: false, discussionReplies: true, collectionUpdates: true, platformReleases: false })
    const saved = await app.inject({ method: 'POST', url: '/v1/me/saved-searches', headers: { cookie: userCookie, origin }, payload: { name: 'Web bundles', query: { kind: 'bundle', surface: 'web', sort: 'recent' } } })
    expect(saved.statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/v1/me/saved-searches', headers: { cookie: userCookie } })).json().items[0]).toMatchObject({ name: 'Web bundles', query: { kind: 'bundle', surface: 'web', sort: 'recent' } })
    const thread = await app.inject({ method: 'POST', url: '/v1/discussions', headers: { cookie: userCookie, origin }, payload: { title: 'Subscription state check', body: 'A real thread used to verify explicit follow and unfollow state.' } })
    const threadId = thread.json().thread.id as string
    expect((await app.inject({ method: 'GET', url: `/v1/me/discussions/${threadId}/subscription`, headers: { cookie: userCookie } })).json()).toEqual({ subscribed: true })
    expect((await app.inject({ method: 'PUT', url: `/v1/me/discussions/${threadId}/subscription`, headers: { cookie: userCookie, origin }, payload: { subscribed: false } })).json()).toEqual({ subscribed: false })
    await app.inject({ method: 'DELETE', url: `/v1/discussions/${threadId}`, headers: { cookie: userCookie, origin } })
    await app.inject({ method: 'PATCH', url: '/v1/me/notification-preferences', headers: { cookie: userCookie, origin }, payload: { pluginUpdates: true, platformReleases: true } })
  })

  it('rejects duplicate identities, weak passwords and cross-site mutations', async () => {
    const duplicate = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: { username: 'normal-user', email: 'other@example.test', password: 'NormalPassword123' } })
    const weak = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: { username: 'another-user', email: 'another@example.test', password: 'passwordonly' } })
    const crossSite = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, payload: { identity: 'admin', password: 'AdminPassword12345' } })
    expect(duplicate.statusCode).toBe(409)
    expect(weak.statusCode).toBe(400)
    expect(crossSite.statusCode).toBe(403)
    expect(crossSite.json().error.code).toBe('AUTH_ORIGIN_DENIED')
  })

  it('persists favorites, subscriptions, collections and one review per user', async () => {
    const favorite = await app.inject({ method: 'POST', url: `/v1/me/favorites/${encodeURIComponent(published.id)}/toggle`, headers: { cookie: userCookie, origin } })
    const subscription = await app.inject({ method: 'POST', url: `/v1/me/subscriptions/${encodeURIComponent(published.id)}/toggle`, headers: { cookie: userCookie, origin } })
    expect(favorite.json().favorites).toContain(published.id)
    expect(subscription.json().subscriptions).toContain(published.id)
    const collection = await app.inject({ method: 'POST', url: '/v1/me/collections', headers: { cookie: userCookie, origin }, payload: { name: 'My Harness stack', description: 'Saved plugins', pluginIds: [published.id, 'not-public'] } })
    expect(collection.statusCode).toBe(201)
    expect(collection.json().collection.pluginIds).toEqual([published.id])
    const reviewed = await app.inject({ method: 'POST', url: `/v1/github-plugins/${encodeURIComponent(published.id)}/reviews`, headers: { cookie: userCookie, origin }, payload: { rating: 5, body: 'Works well in my local profile.' } })
    const updated = await app.inject({ method: 'POST', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews`, headers: { cookie: userCookie, origin }, payload: { rating: 4, body: 'Updated after a second local run.' } })
    const reviews = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews` })
    expect(reviewed.statusCode).toBe(201)
    expect(updated.statusCode).toBe(201)
    expect(reviews.json().summary).toEqual({ count: 1, score: 4 })
    expect(reviews.json()).toMatchObject({ page: 1, pageSize: 20, total: 1, revisionId: expect.any(String) })
    expect(reviews.json().items[0]).toMatchObject({ revisionId: expect.any(String), createdAt: expect.any(String), updatedAt: expect.any(String) })

    const relationList = await app.inject({ method: 'GET', url: '/v1/me/favorites', headers: { cookie: userCookie } })
    expect(relationList.json()).toMatchObject({ total: 1, items: [{ plugin: { id: published.id }, savedAt: expect.any(String) }] })
    const pluginState = await app.inject({ method: 'GET', url: `/v1/me/plugins/${encodeURIComponent(published.id)}/state`, headers: { cookie: userCookie } })
    expect(pluginState.json().state).toMatchObject({ favorited: true, subscribed: true, collectionIds: [collection.json().collection.id], review: { rating: 4 } })

    const changedCollection = await app.inject({ method: 'PATCH', url: `/v1/me/collections/${encodeURIComponent(collection.json().collection.id)}`, headers: { cookie: userCookie, origin }, payload: { name: 'Updated Harness stack', description: 'Updated list', pluginIds: [], visibility: 'private' } })
    expect(changedCollection.json().collection).toMatchObject({ name: 'Updated Harness stack', pluginIds: [] })

    const detail = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}` })
    expect(detail.json().plugin.community).toMatchObject({ favoriteCount: 1, subscriptionCount: 1, reviewCount: 1, reviewScore: 4 })
  })

  it('binds new reviews to the current published revision', async () => {
    const next = plugin(published.id, 'commit-two')
    await accounts.ingestVerifiedPlugins('sync', [next])
    const candidate = accounts.githubSnapshot(true).items.find(item => item.id === published.id)!
    await accounts.moderatePlugin('admin', published.id, { revisionId: candidate.revisionId, status: 'approved' })
    const updateNotifications = await app.inject({ method: 'GET', url: '/v1/me/notifications', headers: { cookie: userCookie } })
    expect(updateNotifications.json()).toMatchObject({ unread: 1, total: 1, items: [{ type: 'plugin.updated', pluginId: published.id }] })
    await accounts.moderatePlugin('admin', published.id, { revisionId: candidate.revisionId, status: 'approved' })
    expect((await app.inject({ method: 'GET', url: '/v1/me/notifications', headers: { cookie: userCookie } })).json().total).toBe(1)
    const before = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews` })
    expect(before.json().summary).toEqual({ count: 0, score: 0 })
    const added = await app.inject({ method: 'POST', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews`, headers: { cookie: userCookie, origin }, payload: { rating: 5, body: 'Confirmed again on the new published revision.' } })
    expect(added.json().review.revisionId).toBe(candidate.revisionId)
    expect((await app.inject({ method: 'GET', url: '/v1/reviews' })).json().items[0]).toMatchObject({ pluginId: published.id, rating: 5 })
    expect((await app.inject({ method: 'GET', url: '/v1/activity' })).json().items.some((item: { type: string }) => item.type === 'plugin.published')).toBe(true)
  })

  it('counts active browsers without double-counting tabs that share a cookie', async () => {
    const first = await app.inject({ method: 'POST', url: '/v1/presence/heartbeat', headers: { 'user-agent': 'Vitest Browser' } })
    const presenceCookie = first.headers['set-cookie']!.split(';', 1)[0]!
    expect(first.json()).toMatchObject({ online: 1, windowSeconds: 90 })
    const secondTab = await app.inject({ method: 'POST', url: '/v1/presence/heartbeat', headers: { cookie: presenceCookie, 'user-agent': 'Vitest Browser' } })
    expect(secondTab.json().online).toBe(1)
    const bot = await app.inject({ method: 'POST', url: '/v1/presence/heartbeat', headers: { 'user-agent': 'Lighthouse' } })
    expect(bot.json().online).toBe(1)
    expect((await app.inject({ method: 'POST', url: '/v1/presence/leave', headers: { cookie: presenceCookie } })).json().online).toBe(0)
  })

  it('keeps private collections private and supports public discovery, cloning and moderation', async () => {
    const privateCollection = await app.inject({ method: 'POST', url: '/v1/me/collections', headers: { cookie: userCookie, origin }, payload: { name: 'Private setup', description: 'Only visible to its owner', pluginIds: [published.id], visibility: 'private' } })
    expect((await app.inject({ method: 'GET', url: `/v1/collections/${privateCollection.json().collection.id}` })).statusCode).toBe(404)

    const created = await app.inject({ method: 'POST', url: '/v1/me/collections', headers: { cookie: userCookie, origin }, payload: { name: 'Public Harness setup', description: 'A reusable public setup', pluginIds: [published.id], visibility: 'public' } })
    const collectionId = created.json().collection.id as string
    expect((await app.inject({ method: 'GET', url: '/v1/collections?q=Harness' })).json()).toMatchObject({ total: 1, items: [{ id: collectionId, visibility: 'public' }] })
    const cloned = await app.inject({ method: 'POST', url: `/v1/collections/${collectionId}/clone`, headers: { cookie: adminCookie, origin } })
    expect(cloned.statusCode).toBe(201)
    expect(cloned.json().collection).toMatchObject({ visibility: 'private', pluginIds: [published.id] })

    const hidden = await app.inject({ method: 'PATCH', url: `/v1/admin/collections/${collectionId}`, headers: { cookie: adminCookie, origin }, payload: { status: 'hidden', reason: 'Temporarily hidden by the community moderation test.' } })
    expect(hidden.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/collections/${collectionId}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/v1/activity' })).json().items.some((item: { collectionId?: string }) => item.collectionId === collectionId)).toBe(false)
  })

  it('supports discussions, replies, notifications, reports and administrator locking', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/discussions', headers: { cookie: userCookie, origin }, payload: { title: 'How should this bundle be configured?', body: 'I need a safe baseline configuration for this verified bundle.', pluginId: published.id } })
    expect(created.statusCode).toBe(201)
    const threadId = created.json().thread.id as string
    expect((await app.inject({ method: 'GET', url: `/v1/discussions/${threadId}` })).json().thread).toMatchObject({ id: threadId, status: 'open' })

    const reply = await app.inject({ method: 'POST', url: `/v1/discussions/${threadId}/replies`, headers: { cookie: adminCookie, origin }, payload: { body: 'Start with the published revision and review its patch evidence.' } })
    expect(reply.statusCode).toBe(201)
    const notifications = await app.inject({ method: 'GET', url: '/v1/me/notifications', headers: { cookie: userCookie } })
    expect(notifications.json().items.some((item: { type: string; threadId?: string }) => item.type === 'discussion.reply' && item.threadId === threadId)).toBe(true)

    const report = await app.inject({ method: 'POST', url: '/v1/reports', headers: { cookie: adminCookie, origin }, payload: { targetType: 'thread', targetId: threadId, reason: 'Test report for the moderation workflow.' } })
    expect(report.json()).toEqual({ created: true })
    const reportList = await app.inject({ method: 'GET', url: '/v1/admin/reports?status=pending', headers: { cookie: adminCookie } })
    expect(reportList.json().items[0]).toMatchObject({ targetType: 'thread', targetId: threadId, status: 'pending' })

    const locked = await app.inject({ method: 'PATCH', url: `/v1/admin/discussions/thread/${threadId}`, headers: { cookie: adminCookie, origin }, payload: { status: 'locked', reason: 'Locking this thread while the report is reviewed.' } })
    expect(locked.statusCode).toBe(200)
    const blockedReply = await app.inject({ method: 'POST', url: `/v1/discussions/${threadId}/replies`, headers: { cookie: userCookie, origin }, payload: { body: 'This reply must be rejected while locked.' } })
    expect(blockedReply.statusCode).toBe(409)
    expect(blockedReply.json().error.code).toBe('DISCUSSION_LOCKED')
    expect((await app.inject({ method: 'GET', url: '/v1/admin/community?type=thread&status=locked', headers: { cookie: adminCookie } })).json()).toMatchObject({ total: 1, items: [{ id: threadId, reportCount: 1 }] })

    const reportId = reportList.json().items[0].id as string
    expect((await app.inject({ method: 'PATCH', url: `/v1/admin/reports/${reportId}`, headers: { cookie: adminCookie, origin }, payload: { status: 'resolved', resolution: 'Reviewed and retained the content while locking replies.' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: { cookie: adminCookie } })).json()).toMatchObject({
      discussions: 1, pendingReports: 0, pendingRevisions: expect.any(Number),
      githubSync: { authenticated: false, batchLimit: 15 },
      presence: { online: 0, peak24h: expect.any(Number) },
    })
  })

  it('blocks relations and reviews for pending or unknown plugins', async () => {
    const pending = plugin('github.community.pending', 'pending-sha')
    await accounts.ingestVerifiedPlugins('system', [pending])
    const relation = await app.inject({ method: 'POST', url: `/v1/me/favorites/${encodeURIComponent(pending.id)}/toggle`, headers: { cookie: userCookie, origin } })
    const review = await app.inject({ method: 'POST', url: `/v1/plugins/${encodeURIComponent(pending.id)}/reviews`, headers: { cookie: userCookie, origin }, payload: { rating: 5, body: 'Should not be accepted.' } })
    expect(relation.statusCode).toBe(404)
    expect(review.statusCode).toBe(404)
  })

  it('enforces administrator authorization, pagination and filters', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/admin/users', headers: { cookie: userCookie } })).statusCode).toBe(403)
    const users = await app.inject({ method: 'GET', url: '/v1/admin/users?q=normal&role=user&status=active&page=1&pageSize=1', headers: { cookie: adminCookie } })
    expect(users.statusCode).toBe(200)
    expect(users.json()).toMatchObject({ page: 1, pageSize: 1, total: 1 })
    expect(users.json().items[0].username).toBe('normal-user')
    const plugins = await app.inject({ method: 'GET', url: '/v1/admin/plugins?status=pending', headers: { cookie: adminCookie } })
    expect(plugins.json().items.every((item: { moderation: { status: string } }) => item.moderation.status === 'pending')).toBe(true)
  })

  it('requires reasons for rejection and records contextual audit data', async () => {
    const target = plugin('github.community.review-target', 'review-sha')
    await accounts.ingestVerifiedPlugins('system', [target])
    const invalid = await app.inject({ method: 'PATCH', url: `/v1/admin/plugins/${encodeURIComponent(target.id)}`, headers: { cookie: adminCookie, origin }, payload: { revisionId: `${target.id}@review-sha:package.json`, status: 'rejected' } })
    expect(invalid.statusCode).toBe(400)
    const rejected = await app.inject({ method: 'PATCH', url: `/v1/admin/plugins/${encodeURIComponent(target.id)}`, headers: { cookie: adminCookie, origin, 'x-request-id': 'moderation-request' }, payload: { revisionId: `${target.id}@review-sha:package.json`, status: 'rejected', reason: 'Bundle evidence does not meet publication policy.' } })
    expect(rejected.statusCode).toBe(200)
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?action=plugin.moderate', headers: { cookie: adminCookie } })
    expect(audit.json().items[0]).toMatchObject({ action: 'plugin.moderate', target: target.id, requestId: 'moderation-request' })
  })

  it('protects the current administrator from self lockout', async () => {
    const me = (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: adminCookie } })).json().user
    const response = await app.inject({ method: 'PATCH', url: `/v1/admin/users/${me.id}`, headers: { cookie: adminCookie, origin }, payload: { status: 'disabled' } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('ADMIN_SELF_LOCKOUT_DENIED')
  })

  it('changes passwords and revokes every existing session', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/auth/change-password', headers: { cookie: userCookie, origin }, payload: { currentPassword: 'NormalPassword123', nextPassword: 'ChangedPassword456' } })
    expect(response.json()).toEqual({ ok: true, reloginRequired: true })
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: userCookie } })).json().authenticated).toBe(false)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { identity: 'normal-user', password: 'ChangedPassword456' } })).statusCode).toBe(200)
  })
})
