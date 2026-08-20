import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const root = resolve(process.cwd())
const port = Number.parseInt(process.env.WORKSHOP_PREVIEW_PORT ?? '4273', 10)
const apiPort = Number.parseInt(process.env.WORKSHOP_API_PORT ?? '4100', 10)
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }

function proxy(request, response) {
  const upstream = httpRequest({ hostname: '127.0.0.1', port: apiPort, path: request.url.replace(/^\/api/, ''), method: request.method, headers: { ...request.headers, host: `127.0.0.1:${apiPort}` } }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', () => { response.writeHead(502, { 'Content-Type': 'application/json' }); response.end('{"error":{"message":"API unavailable"}}') })
  request.pipe(upstream)
}

async function staticFile(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  if (relative === '' || /^(?:workshop|plugin|discussion|collection|collections)\/?$/.test(relative)) relative = 'index.html'
  else if (relative.endsWith('/')) relative += 'index.html'
  let target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end('Forbidden'); return }
  try {
    if (!(await stat(target)).isFile()) throw new Error('not file')
  } catch {
    if (!extname(relative)) target = resolve(root, 'index.html')
    else { response.writeHead(404); response.end('Not found'); return }
  }
  response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(target).pipe(response)
}

createServer((request, response) => request.url?.startsWith('/api/') ? proxy(request, response) : void staticFile(request, response).catch(() => { response.writeHead(500); response.end('Internal error') }))
  .listen(port, '127.0.0.1', () => process.stdout.write(`Workshop preview listening at http://127.0.0.1:${port}\n`))
