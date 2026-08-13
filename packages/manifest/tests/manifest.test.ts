import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createManifestValidator } from '../src/index.ts'

describe('workshop manifest', () => {
  it('accepts the published example and rejects missing identity', async () => {
    const schema = JSON.parse(await readFile(resolve('spec/workshop-manifest.schema.json'), 'utf8'))
    const example = JSON.parse(await readFile(resolve('examples/workshop-manifest.example.json'), 'utf8'))
    const validate = createManifestValidator(schema)
    expect(validate(example)).toEqual({ ok: true })
    const { identity: _, ...invalid } = example
    const result = validate(invalid)
    expect(result.ok).toBe(false)
  })
})
