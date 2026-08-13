import { describe, expect, it } from 'vitest'
import { compareRisk, permissionRisk, type PermissionSet } from '../src/index.ts'

const empty: PermissionSet = {
  filesystem: { required: false, items: [] },
  process: { required: false, items: [] },
  network: { required: false, items: [] },
  credentials: { required: false, items: [] },
  modelContext: { required: false, items: [] },
  telemetry: { required: false, items: [] },
  lifecycleScripts: { required: false, items: [] },
}

describe('permissionRisk', () => {
  it('classifies privileged lifecycle access as high risk', () => {
    expect(permissionRisk({ ...empty, lifecycleScripts: { required: true, items: ['prepare'] } })).toBe('high')
  })

  it('classifies network access as moderate risk', () => {
    expect(permissionRisk({ ...empty, network: { required: true, items: ['api.example.com'] } })).toBe('moderate')
  })

  it('orders risk levels', () => {
    expect(compareRisk('low', 'high')).toBeLessThan(0)
  })
})
