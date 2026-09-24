import { createHash } from 'node:crypto'

export class IntentProviderBusyError extends Error {
  constructor() {
    super('INTENT_PROVIDER_BUSY')
  }
}

export function createIntentRequestKey(input, model, promptVersion) {
  return createHash('sha256').update(JSON.stringify({
    model,
    promptVersion,
    normalizedText: input.normalizedText,
    ambiguities: input.ambiguities,
  })).digest('hex')
}

export function createIntentCache({ ttlMs = 86_400_000, maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map()
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, { value, expiresAt: now() + ttlMs })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    },
    get size() { return entries.size },
  }
}

export function createRateLimiter({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
  const clients = new Map()
  return {
    consume(clientId) {
      const timestamp = now()
      const start = timestamp - windowMs
      const recent = (clients.get(clientId) ?? []).filter(item => item > start)
      if (recent.length >= limit) {
        clients.set(clientId, recent)
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - timestamp) / 1_000)),
        }
      }
      recent.push(timestamp)
      clients.set(clientId, recent)
      return { allowed: true, remaining: Math.max(0, limit - recent.length), retryAfterSeconds: 0 }
    },
  }
}

export function createConcurrencyGate({ maxConcurrent = 2, maxQueue = 20 } = {}) {
  let active = 0
  const queue = []
  const release = () => {
    active -= 1
    queue.shift()?.()
  }
  return {
    async run(task) {
      if (active >= maxConcurrent) {
        if (queue.length >= maxQueue) throw new IntentProviderBusyError()
        await new Promise(resolve => queue.push(resolve))
      }
      active += 1
      try {
        return await task()
      } finally {
        release()
      }
    },
    snapshot() { return { active, queued: queue.length } },
  }
}

export function createIntentCoordinator({ cache, gate }) {
  const inFlight = new Map()
  return {
    async execute(key, task) {
      const cached = cache.get(key)
      if (cached !== undefined) return { source: 'cache', value: cached }
      if (inFlight.has(key)) return { source: 'shared', value: await inFlight.get(key) }

      const promise = gate.run(task).then(value => {
        cache.set(key, value)
        return value
      })
      inFlight.set(key, promise)
      try {
        return { source: 'provider', value: await promise }
      } finally {
        inFlight.delete(key)
      }
    },
  }
}

export function estimateIntentCost(usage, rates) {
  if (!usage || !rates) return 0
  const prompt = usage.prompt_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const completion = usage.completion_tokens ?? 0
  return ((prompt - cached) * rates.input + cached * rates.cached + completion * rates.output) / 1_000_000
}

export function createIntentMetrics() {
  const totals = { requests: 0, providerCalls: 0, cacheHits: 0, sharedHits: 0, failures: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 }
  return {
    record(event) {
      totals.requests += 1
      if (event.source === 'provider') totals.providerCalls += 1
      if (event.source === 'cache') totals.cacheHits += 1
      if (event.source === 'shared') totals.sharedHits += 1
      if (event.failed) totals.failures += 1
      totals.promptTokens += event.usage?.prompt_tokens ?? 0
      totals.completionTokens += event.usage?.completion_tokens ?? 0
      totals.estimatedCostUsd += event.costUsd ?? 0
    },
    snapshot() { return { ...totals, estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(8)) } },
  }
}
