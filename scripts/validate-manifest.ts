import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createManifestValidator } from '@dsh-workshop/manifest'

const schemaPath = resolve('spec/workshop-manifest.schema.json')
const manifestPath = resolve(process.argv[2] ?? 'examples/workshop-manifest.example.json')
const [schema, manifest] = await Promise.all([
  readFile(schemaPath, 'utf8').then(JSON.parse),
  readFile(manifestPath, 'utf8').then(JSON.parse),
])
const validate = createManifestValidator(schema)
const result = validate(manifest)
if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result.issues, null, 2)}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`${manifestPath} valid\n`)
}
