import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats'

// ajv-formats publishes CommonJS declarations. The explicit cast keeps the
// runtime-compatible default import callable under TypeScript NodeNext.
const addFormats = addFormatsImport as unknown as FormatsPlugin

export interface ValidationIssue {
  path: string
  keyword: string
  message: string
}

export type ValidationResult = { ok: true } | { ok: false; issues: readonly ValidationIssue[] }

export function createManifestValidator(schema: object): (value: unknown) => ValidationResult {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  return (value: unknown): ValidationResult => {
    if (validate(value)) return { ok: true }
    return { ok: false, issues: (validate.errors ?? []).map(renderIssue) }
  }
}

function renderIssue(error: ErrorObject): ValidationIssue {
  return {
    path: error.instancePath === '' ? '/' : error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'validation failed',
  }
}
