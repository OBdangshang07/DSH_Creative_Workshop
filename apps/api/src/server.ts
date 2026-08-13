import { buildApi } from './app.js'

const port = Number.parseInt(process.env.WORKSHOP_API_PORT ?? '4100', 10)
const host = process.env.WORKSHOP_API_HOST ?? '127.0.0.1'
const app = await buildApi()

try {
  await app.listen({ host, port })
  process.stdout.write(`DSH Workshop API listening at http://${host}:${port}\n`)
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
