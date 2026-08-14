import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApi } from '../src/app.ts'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'

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
    expect(ready.json()).toMatchObject({ ok: true, version: '1.1.0', storage: 'sqlite-wal', catalog: 1 })
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

    const changedCollection = await app.inject({ method: 'PATCH', url: `/v1/me/collections/${encodeURIComponent(collection.json().collection.id)}`, headers: { cookie: userCookie, origin }, payload: { name: 'Updated Harness stack', description: 'Updated list', pluginIds: [] } })
    expect(changedCollection.json().collection).toMatchObject({ name: 'Updated Harness stack', pluginIds: [] })

    const detail = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}` })
    expect(detail.json().plugin.community).toMatchObject({ favoriteCount: 1, subscriptionCount: 1, reviewCount: 1, reviewScore: 4 })
  })

  it('binds new reviews to the current published revision', async () => {
    const next = plugin(published.id, 'commit-two')
    await accounts.ingestVerifiedPlugins('sync', [next])
    const candidate = accounts.githubSnapshot(true).items.find(item => item.id === published.id)!
    await accounts.moderatePlugin('admin', published.id, { revisionId: candidate.revisionId, status: 'approved' })
    const before = await app.inject({ method: 'GET', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews` })
    expect(before.json().summary).toEqual({ count: 0, score: 0 })
    const added = await app.inject({ method: 'POST', url: `/v1/plugins/${encodeURIComponent(published.id)}/reviews`, headers: { cookie: userCookie, origin }, payload: { rating: 5, body: 'Confirmed again on the new published revision.' } })
    expect(added.json().review.revisionId).toBe(candidate.revisionId)
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
