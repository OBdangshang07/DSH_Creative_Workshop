import { readFile } from 'node:fs/promises'
import type { RevisionChangeItem, WorkshopRelease } from './auth-store.js'
import { APP_VERSION } from './version.js'

const changeTypes = new Set<RevisionChangeItem['type']>(['added', 'changed', 'fixed', 'removed', 'security', 'other'])

export async function loadWorkshopRelease(): Promise<WorkshopRelease> {
  const url = new URL(`../../../releases/v${APP_VERSION}.json`, import.meta.url)
  const value = JSON.parse(await readFile(url, 'utf8')) as Record<string, unknown>
  if (value.version !== APP_VERSION || typeof value.title !== 'string' || typeof value.summary !== 'string' || typeof value.publishedAt !== 'string' || !Array.isArray(value.changes)) {
    throw new Error(`RELEASE_MANIFEST_INVALID_${APP_VERSION}`)
  }
  const changes = value.changes.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    if (!changeTypes.has(item.type as RevisionChangeItem['type']) || typeof item.text !== 'string' || item.text.trim() === '') return []
    return [{ type: item.type as RevisionChangeItem['type'], text: item.text.trim() }]
  })
  if (changes.length === 0 || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error(`RELEASE_MANIFEST_INVALID_${APP_VERSION}`)
  return { version: APP_VERSION, title: value.title, summary: value.summary, publishedAt: value.publishedAt, changes }
}
