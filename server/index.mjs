import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIntentProviderConfig, requestIntentEnhancementDetailed, validateIntentApiInput } from './intent-provider.mjs'
import {
  IntentProviderBusyError,
  createConcurrencyGate,
  createIntentCache,
  createIntentCoordinator,
  createIntentMetrics,
  createIntentRequestKey,
  createRateLimiter,
  estimateIntentCost,
} from './intent-runtime.mjs'

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
const numberSetting = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback)
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}
const cache = createIntentCache({
  ttlMs: numberSetting('TOROB_MATCH_INTENT_CACHE_TTL_MS', 86_400_000, 1_000, 604_800_000),
  maxEntries: numberSetting('TOROB_MATCH_INTENT_CACHE_MAX_ENTRIES', 500, 1, 10_000),
})
const rateLimit = numberSetting('TOROB_MATCH_INTENT_RATE_LIMIT', 10, 1, 1_000)
const rateWindowMs = numberSetting('TOROB_MATCH_INTENT_RATE_WINDOW_MS', 60_000, 1_000, 3_600_000)
const limiter = createRateLimiter({ limit: rateLimit, windowMs: rateWindowMs })
const gate = createConcurrencyGate({
  maxConcurrent: numberSetting('TOROB_MATCH_INTENT_MAX_CONCURRENT', 2, 1, 20),
  maxQueue: numberSetting('TOROB_MATCH_INTENT_MAX_QUEUE', 20, 0, 1_000),
})
const coordinator = createIntentCoordinator({ cache, gate })
const metrics = createIntentMetrics()
const metricsEnabled = process.env.TOROB_MATCH_INTENT_METRICS_ENABLED !== 'false'
const promptVersion = process.env.TOROB_MATCH_INTENT_PROMPT_VERSION || '2026-09-24-v2'
const defaultRates = config.model === 'gpt-6-luna' ? { input: .1, cached: .01, output: .5 } : { input: 0, cached: 0, output: 0 }
const pricing = {
  input: numberSetting('TOROB_MATCH_INTENT_INPUT_USD_PER_MILLION', defaultRates.input, 0, 1_000),
  cached: numberSetting('TOROB_MATCH_INTENT_CACHED_USD_PER_MILLION', defaultRates.cached, 0, 1_000),
  output: numberSetting('TOROB_MATCH_INTENT_OUTPUT_USD_PER_MILLION', defaultRates.output, 0, 1_000),
}

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

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
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
  const origin = request.headers.origin
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) return json(response, 403, { error: 'origin_not_allowed' })
    } catch {
      return json(response, 403, { error: 'origin_not_allowed' })
    }
  }
  if (!config.enabled) return json(response, 503, { error: 'intent_enhancer_disabled' })
  const allowance = limiter.consume(request.socket.remoteAddress || 'unknown')
  if (!allowance.allowed) return json(response, 429, { error: 'rate_limited' }, {
    'retry-after': String(allowance.retryAfterSeconds),
    'x-ratelimit-limit': String(rateLimit),
    'x-ratelimit-remaining': '0',
  })
  const started = performance.now()
  try {
    const input = await readJsonBody(request)
    if (!validateIntentApiInput(input)) return json(response, 400, { error: 'invalid_request' })
    const key = createIntentRequestKey(input, config.model, promptVersion)
    const { source, value } = await coordinator.execute(key, () => requestIntentEnhancementDetailed(input, config, schema))
    const elapsedMs = Math.round(performance.now() - started)
    const usage = source === 'provider' ? value.usage : null
    const costUsd = source === 'provider' ? estimateIntentCost(usage, pricing) : 0
    metrics.record({ source, usage, costUsd })
    if (metricsEnabled) console.info('[intent-metrics]', JSON.stringify({
      source,
      elapsedMs,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      estimatedCostUsd: Number(costUsd.toFixed(8)),
    }))
    return json(response, 200, value.output, {
      'server-timing': `intent;dur=${elapsedMs}`,
      'x-ratelimit-limit': String(rateLimit),
      'x-ratelimit-remaining': String(allowance.remaining),
      'x-torob-match-cache': source,
      'x-torob-match-estimated-cost-usd': costUsd.toFixed(8),
    })
  } catch (error) {
    const status = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
      ? 413
      : error instanceof IntentProviderBusyError ? 503 : 502
    const code = status === 413 ? 'request_too_large' : error instanceof IntentProviderBusyError ? 'provider_busy' : 'provider_unavailable'
    const failedBeforeProvider = status === 413 || error instanceof IntentProviderBusyError
    metrics.record({ source: failedBeforeProvider ? 'local' : 'provider', failed: true })
    console.error('[intent-enhancer]', error instanceof Error ? error.message : 'unknown error')
    return json(response, status, { error: code }, error instanceof IntentProviderBusyError ? { 'retry-after': '1' } : {})
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
    'cache-control': extension === '.html'
      ? 'no-cache'
      : relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'",
  })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (pathname === '/api/intent/enhance') return handleIntent(request, response)
  if (pathname === '/api/intent/status') return json(response, 200, {
    enabled: config.enabled,
    provider: 'openai-compatible',
    ...(metricsEnabled ? { runtime: { ...metrics.snapshot(), cacheEntries: cache.size, ...gate.snapshot() } } : {}),
  })
  return serveStatic(request, response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Torob Match is available at http://127.0.0.1:${port}`)
  console.log(`Optional intent enhancer: ${config.enabled ? 'enabled' : 'disabled'}`)
})
