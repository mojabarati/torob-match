import { describe, expect, it, vi } from 'vitest'
import { HttpIntentEnhancer } from './http-intent-enhancer'

const input = {
  rawText: 'RAG با بودجه نامشخص',
  normalizedText: 'rag با بودجه نامشخص',
  ambiguities: ['مقدار بودجه از متن قابل استخراج نیست.'],
  deterministicFields: {},
}

describe('HTTP intent enhancer adapter', () => {
  it('sends only the minimum ambiguity context to the same-origin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"fields":{}}'),
    })
    const enhancer = new HttpIntentEnhancer('/api/intent/enhance', fetchMock as typeof fetch)
    const controller = new AbortController()

    await expect(enhancer.enhance(input, { signal: controller.signal })).resolves.toEqual({ fields: {} })
    expect(fetchMock).toHaveBeenCalledWith('/api/intent/enhance', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      rawText: input.rawText,
      normalizedText: input.normalizedText,
      ambiguities: input.ambiguities,
    })
    expect(body).not.toHaveProperty('deterministicFields')
  })

  it('binds the browser fetch implementation to the global object', async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"fields":{}}'),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const enhancer = new HttpIntentEnhancer()
      await expect(enhancer.enhance(input, { signal: new AbortController().signal })).resolves.toEqual({ fields: {} })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects failed, invalid, and oversized responses', async () => {
    const controller = new AbortController()
    const failed = new HttpIntentEnhancer('/api', vi.fn().mockResolvedValue({ ok: false, status: 503 }) as typeof fetch)
    const invalid = new HttpIntentEnhancer('/api', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('not-json') }) as typeof fetch)
    const oversized = new HttpIntentEnhancer('/api', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x'.repeat(32_001)) }) as typeof fetch)

    await expect(failed.enhance(input, { signal: controller.signal })).rejects.toThrow('INTENT_ENHANCER_HTTP_503')
    await expect(invalid.enhance(input, { signal: controller.signal })).rejects.toThrow('INTENT_ENHANCER_INVALID_JSON')
    await expect(oversized.enhance(input, { signal: controller.signal })).rejects.toThrow('INTENT_ENHANCER_RESPONSE_TOO_LARGE')
  })
})
