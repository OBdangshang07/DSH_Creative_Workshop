import { buildApi } from './app.js'

const port = Number.parseInt(process.env.WORKSHOP_API_PORT ?? '4100', 10)
const host = process.env.WORKSHOP_API_HOST ?? '127.0.0.1'
const allowedOrigins = (process.env.WORKSHOP_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const bootstrapAdmin = process.env.WORKSHOP_ADMIN_PASSWORD === undefined ? undefined : {
  username: process.env.WORKSHOP_ADMIN_USERNAME ?? 'admin',
  email: process.env.WORKSHOP_ADMIN_EMAIL ?? 'admin@localhost.invalid',
  password: process.env.WORKSHOP_ADMIN_PASSWORD,
}
const app = await buildApi({
  allowedOrigins,
  dataFile: process.env.WORKSHOP_DATA_FILE ?? '/var/lib/dsh-workshop/data.json',
  ...(bootstrapAdmin === undefined ? {} : { bootstrapAdmin }),
  ...(process.env.GITHUB_TOKEN === undefined ? {} : { githubToken: process.env.GITHUB_TOKEN }),
})

try {
  await app.listen({ host, port })
  process.stdout.write(`DSH Workshop API listening at http://${host}:${port}\n`)
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
