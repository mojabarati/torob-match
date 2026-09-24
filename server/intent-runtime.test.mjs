import assert from 'node:assert/strict'
import test from 'node:test'
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

test('cache expires entries and evicts the least recently used item', () => {
  let timestamp = 0
  const cache = createIntentCache({ ttlMs: 100, maxEntries: 2, now: () => timestamp })
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.get('a'), 1)
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  timestamp = 101
  assert.equal(cache.get('a'), undefined)
})

test('coordinator caches successful work and shares identical in-flight requests', async () => {
  const cache = createIntentCache()
  const gate = createConcurrencyGate()
  const coordinator = createIntentCoordinator({ cache, gate })
  let calls = 0
  let release
  const task = () => {
    calls += 1
    return new Promise(resolve => { release = () => resolve({ output: { fields: {} } }) })
  }
  const first = coordinator.execute('key', task)
  const second = coordinator.execute('key', task)
  await new Promise(resolve => setImmediate(resolve))
  release()
  assert.equal((await first).source, 'provider')
  assert.equal((await second).source, 'shared')
  assert.equal(calls, 1)
  assert.equal((await coordinator.execute('key', task)).source, 'cache')
})

test('rate limiter returns a retry delay after the configured allowance', () => {
  let timestamp = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => timestamp })
  assert.equal(limiter.consume('client').allowed, true)
  assert.equal(limiter.consume('client').allowed, true)
  assert.deepEqual(limiter.consume('client'), { allowed: false, remaining: 0, retryAfterSeconds: 1 })
  timestamp = 1_001
  assert.equal(limiter.consume('client').allowed, true)
})

test('concurrency gate rejects work when its queue is full', async () => {
  const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 0 })
  let release
  const active = gate.run(() => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(() => gate.run(async () => true), IntentProviderBusyError)
  release(true)
  await active
})

test('request keys exclude raw text and cost metrics use provider token usage', () => {
  const first = createIntentRequestKey({ rawText: 'متن خصوصی اول', normalizedText: 'rag', ambiguities: ['بودجه'] }, 'model', 'v1')
  const second = createIntentRequestKey({ rawText: 'متن خصوصی دوم', normalizedText: 'rag', ambiguities: ['بودجه'] }, 'model', 'v1')
  assert.equal(first, second)
  const usage = { prompt_tokens: 1_000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } }
  const cost = estimateIntentCost(usage, { input: .1, cached: .01, output: .5 })
  assert.equal(cost, .000191)
  const metrics = createIntentMetrics()
  metrics.record({ source: 'provider', usage, costUsd: cost })
  metrics.record({ source: 'local', failed: true })
  assert.deepEqual(metrics.snapshot(), {
    requests: 2,
    providerCalls: 1,
    cacheHits: 0,
    sharedHits: 0,
    failures: 1,
    promptTokens: 1_000,
    completionTokens: 200,
    estimatedCostUsd: .000191,
  })
})
