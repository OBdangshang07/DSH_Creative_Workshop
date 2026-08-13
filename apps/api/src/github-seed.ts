import type { GitHubPluginRecord } from './auth-store.js'

// Topic membership is discovery metadata, not proof of a DSH bundle. The live
// sync verifies package.json and its referenced Cordis patch before persisting
// anything, so there is intentionally no unverified fallback catalog.
export const githubSeed: GitHubPluginRecord[] = []
