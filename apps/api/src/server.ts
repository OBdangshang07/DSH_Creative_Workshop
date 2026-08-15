import { buildApi } from './app.js'

const port = Number.parseInt(process.env.WORKSHOP_API_PORT ?? '4100', 10)
const host = process.env.WORKSHOP_API_HOST ?? '127.0.0.1'
const allowedOrigins = (process.env.WORKSHOP_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
if (process.env.WORKSHOP_ADMIN_PASSWORD !== undefined && process.env.WORKSHOP_ADMIN_PASSWORD.length < 10) {
  throw new Error('WORKSHOP_ADMIN_PASSWORD must contain at least 10 characters')
}
const bootstrapAdmin = process.env.WORKSHOP_ADMIN_PASSWORD === undefined ? undefined : {
  username: process.env.WORKSHOP_ADMIN_USERNAME ?? 'admin',
  email: process.env.WORKSHOP_ADMIN_EMAIL ?? 'admin@localhost.invalid',
  password: process.env.WORKSHOP_ADMIN_PASSWORD,
}
const githubToken = process.env.GITHUB_TOKEN?.trim()
const mediaDirectory = process.env.WORKSHOP_MEDIA_DIRECTORY?.trim() || (process.env.NODE_ENV === 'production' ? '/var/lib/dsh-workshop/media' : undefined)
const app = await buildApi({
  allowedOrigins,
  dataFile: process.env.WORKSHOP_DATABASE_FILE ?? '/var/lib/dsh-workshop/workshop.sqlite',
  legacyDataFile: process.env.WORKSHOP_DATA_FILE ?? '/var/lib/dsh-workshop/data.json',
  ...(mediaDirectory === undefined ? {} : { mediaDirectory }),
  logger: process.env.NODE_ENV === 'production',
  ...(bootstrapAdmin === undefined ? {} : { bootstrapAdmin }),
  ...(githubToken === undefined || githubToken === '' ? {} : { githubToken }),
})

try {
  await app.listen({ host, port })
  process.stdout.write(`DSH Workshop API listening at http://${host}:${port}\n`)
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
