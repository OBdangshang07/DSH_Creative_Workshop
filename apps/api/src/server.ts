import { buildApi } from './app.js'

const port = Number.parseInt(process.env.WORKSHOP_API_PORT ?? '4100', 10)
const host = process.env.WORKSHOP_API_HOST ?? '127.0.0.1'
const allowedOrigins = (process.env.WORKSHOP_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const app = await buildApi({ allowedOrigins })

try {
  await app.listen({ host, port })
  process.stdout.write(`DSH Workshop API listening at http://${host}:${port}\n`)
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
