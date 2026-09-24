import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIntentProviderConfig, requestIntentEnhancement, validateIntentApiInput } from './intent-provider.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')

function loadLocalEnv(path = join(root, '.env')) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (!(key in process.env)) process.env[key] = value
  }
}

loadLocalEnv()
const config = createIntentProviderConfig()
const schema = JSON.parse(readFileSync(join(root, 'data', 'intent-enhancer-schema.json'), 'utf8'))
const port = Number(process.env.PORT || 4174)

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const json = (response, status, body) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 16_384) throw new Error('REQUEST_TOO_LARGE')
  }
  return JSON.parse(body)
}

async function handleIntent(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' })
  if (!config.enabled) return json(response, 503, { error: 'intent_enhancer_disabled' })
  try {
    const input = await readJsonBody(request)
    if (!validateIntentApiInput(input)) return json(response, 400, { error: 'invalid_request' })
    const result = await requestIntentEnhancement(input, config, schema)
    return json(response, 200, result)
  } catch (error) {
    const status = error instanceof Error && error.message === 'REQUEST_TOO_LARGE' ? 413 : 502
    console.error('[intent-enhancer]', error instanceof Error ? error.message : 'unknown error')
    return json(response, status, { error: status === 413 ? 'request_too_large' : 'provider_unavailable' })
  }
}

function serveStatic(request, response) {
  if (!existsSync(dist)) return json(response, 503, { error: 'build_missing', hint: 'Run npm run build first.' })
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  let relativePath
  try {
    relativePath = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
  } catch {
    return json(response, 400, { error: 'invalid_path' })
  }
  let filePath = resolve(dist, relativePath)
  if (filePath !== dist && !filePath.startsWith(`${dist}${sep}`)) return json(response, 403, { error: 'forbidden' })
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(dist, 'index.html')
  const extension = extname(filePath)
  response.writeHead(200, {
    'content-type': mimeTypes[extension] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'",
  })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (pathname === '/api/intent/enhance') return handleIntent(request, response)
  if (pathname === '/api/intent/status') return json(response, 200, { enabled: config.enabled, provider: 'openai-compatible' })
  return serveStatic(request, response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Torob Match is available at http://127.0.0.1:${port}`)
  console.log(`Optional intent enhancer: ${config.enabled ? 'enabled' : 'disabled'}`)
})
