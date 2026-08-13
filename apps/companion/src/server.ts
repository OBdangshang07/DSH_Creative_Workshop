import { buildCompanion } from './app.js'

const host = process.env.WORKSHOP_COMPANION_HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
  throw new Error('Companion refuses non-loopback WORKSHOP_COMPANION_HOST')
}
const port = Number.parseInt(process.env.WORKSHOP_COMPANION_PORT ?? '4101', 10)
const allowedOrigins = (process.env.WORKSHOP_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const app = await buildCompanion({
  ...(process.env.WORKSHOP_COMPANION_TOKEN === undefined ? {} : { authToken: process.env.WORKSHOP_COMPANION_TOKEN }),
  allowedOrigins,
})

try {
  await app.listen({ host, port })
  process.stdout.write(`DSH Workshop Companion listening at http://${host}:${port} (dry-run only)\n`)
  process.stdout.write(`Local token: ${app.companionToken}\n`)
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
