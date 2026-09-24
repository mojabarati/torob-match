import type { IntentEnhancer, IntentEnhancerContext, IntentEnhancerInput } from './intent-enhancer'

type FetchLike = typeof fetch

export class HttpIntentEnhancer implements IntentEnhancer {
  readonly id = 'openai-compatible-http'

  constructor(
    private readonly endpoint = '/api/intent/enhance',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async enhance(input: IntentEnhancerInput, { signal }: IntentEnhancerContext): Promise<unknown> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rawText: input.rawText,
        normalizedText: input.normalizedText,
        ambiguities: input.ambiguities,
      }),
      credentials: 'same-origin',
      signal,
    })
    if (!response.ok) throw new Error(`INTENT_ENHANCER_HTTP_${response.status}`)
    const payload = await response.text()
    if (payload.length > 32_000) throw new Error('INTENT_ENHANCER_RESPONSE_TOO_LARGE')
    try {
      return JSON.parse(payload) as unknown
    } catch {
      throw new Error('INTENT_ENHANCER_INVALID_JSON')
    }
  }
}

export const createConfiguredIntentEnhancer = (): IntentEnhancer | undefined => (
  import.meta.env.VITE_INTENT_ENHANCER_ENABLED === 'true'
    ? new HttpIntentEnhancer(import.meta.env.VITE_INTENT_ENHANCER_ENDPOINT || '/api/intent/enhance')
    : undefined
)

export const getConfiguredIntentEnhancerTimeout = () => {
  const timeout = Number(import.meta.env.VITE_INTENT_ENHANCER_TIMEOUT_MS || 15_000)
  return Number.isFinite(timeout) && timeout >= 500 && timeout <= 30_000 ? timeout : 15_000
}
