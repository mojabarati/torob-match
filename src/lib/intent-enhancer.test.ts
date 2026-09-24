import { describe, expect, it, vi } from 'vitest'
import sampleQuery from '../../data/sample-query.json'
import { enhanceSearchIntent, NoopIntentEnhancer, type IntentEnhancer } from './intent-enhancer'
import type { SearchQuery } from './ranking'

const base = sampleQuery as SearchQuery

const mockEnhancer = (output: unknown): IntentEnhancer => ({
  id: 'mock',
  enhance: vi.fn().mockResolvedValue(output),
})

describe('optional intent enhancer', () => {
  it('stays disabled unless an enhancer is explicitly provided', async () => {
    const result = await enhanceSearchIntent('RAG می خواهم ولی بودجه ام مشخص نیست', base)
    expect(result.usedEnhancer).toBe(false)
    expect(result.ambiguities).toContain('مقدار بودجه از متن قابل استخراج نیست.')
  })

  it('does not call the enhancer when deterministic parsing found no ambiguity', async () => {
    const enhancer = mockEnhancer({ fields: {} })
    const result = await enhanceSearchIntent('RAG با بودجه ۳ تا ۸ میلیون', base, enhancer)
    expect(enhancer.enhance).not.toHaveBeenCalled()
    expect(result.usedEnhancer).toBe(false)
  })

  it('fills only unresolved fields with validated suggestions', async () => {
    const result = await enhanceSearchIntent('RAG می خواهم ولی بودجه ام مشخص نیست', base, mockEnhancer({
      fields: {
        'budget.preferred_max_toman': { value: 7_000_000, confidence: .92, evidence: 'بودجه انعطاف پذیر است' },
        'budget.flexible_max_toman': { value: 12_000_000, confidence: .88 },
      },
    }))

    expect(result.usedEnhancer).toBe(true)
    expect(result.query.budget.preferred_max_toman).toBe(7_000_000)
    expect(result.query.budget.flexible_max_toman).toBe(12_000_000)
    expect(result.fields['budget.preferred_max_toman']).toMatchObject({
      source: 'llm',
      confidence: .85,
      value: 7_000_000,
    })
    expect(result.ambiguities).not.toContain('مقدار بودجه از متن قابل استخراج نیست.')
  })

  it('never overwrites a deterministic value', async () => {
    const result = await enhanceSearchIntent('RAG با بودجه ۳ تا ۸ میلیون و ساعت نامشخص', base, mockEnhancer({
      fields: {
        'budget.flexible_max_toman': { value: 20_000_000, confidence: 1 },
        'time.preferred_hours_per_week': { value: 7, confidence: .7 },
      },
    }))

    expect(result.query.budget.flexible_max_toman).toBe(8_000_000)
    expect(result.fields['budget.flexible_max_toman'].source).toBe('deterministic')
    expect(result.query.time.preferred_hours_per_week).toBe(7)
    expect(result.warnings.some(warning => warning.includes('با مقدار قطعی جایگزین نشد'))).toBe(true)
  })

  it('rejects unknown fields and invalid values without exposing them to ranking', async () => {
    const result = await enhanceSearchIntent('RAG با بودجه نامشخص', base, mockEnhancer({
      fields: {
        supported: { value: true, confidence: 1 },
        'budget.flexible_max_toman': { value: 90_000_000, confidence: 1 },
      },
    }))

    expect(result.query.budget.flexible_max_toman).toBe(base.budget.flexible_max_toman)
    expect(result.warnings.some(warning => warning.includes('فیلد ناشناخته'))).toBe(true)
    expect(result.warnings.some(warning => warning.includes('معتبر نبود'))).toBe(true)
  })

  it('rejects a validly typed batch when its ranges are inconsistent', async () => {
    const result = await enhanceSearchIntent('RAG با بودجه نامشخص', base, mockEnhancer({
      fields: {
        'budget.preferred_max_toman': { value: 20_000_000, confidence: .7 },
        'budget.flexible_max_toman': { value: 10_000_000, confidence: .7 },
      },
    }))

    expect(result.query.budget).toEqual(base.budget)
    expect(result.warnings).toContain('پیشنهادهای بهبوددهنده با محدودیت‌های جست‌وجو سازگار نبودند و اعمال نشدند.')
  })

  it('falls back after a timeout and aborts the provider request', async () => {
    let aborted = false
    const enhancer: IntentEnhancer = {
      id: 'slow-mock',
      enhance: (_input, { signal }) => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve({ fields: {} })
        })
      }),
    }
    const result = await enhanceSearchIntent('RAG با بودجه نامشخص', base, enhancer, { timeoutMs: 5 })

    expect(aborted).toBe(true)
    expect(result.query.budget).toEqual(base.budget)
    expect(result.warnings).toContain('زمان پاسخ بهبوددهنده تمام شد؛ نتیجهٔ قطعی استفاده شد.')
  })

  it('keeps the deterministic result when the provider fails or is a no-op', async () => {
    const failed: IntentEnhancer = {
      id: 'failed-mock',
      enhance: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    }
    const failedResult = await enhanceSearchIntent('RAG با بودجه نامشخص', base, failed)
    const noopResult = await enhanceSearchIntent('RAG با بودجه نامشخص', base, new NoopIntentEnhancer())

    expect(failedResult.query.budget).toEqual(base.budget)
    expect(failedResult.warnings).toContain('بهبوددهنده در دسترس نبود؛ نتیجهٔ قطعی استفاده شد.')
    expect(noopResult.query.budget).toEqual(base.budget)
    expect(noopResult.usedEnhancer).toBe(true)
  })
})
