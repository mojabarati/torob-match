import { describe, expect, it } from 'vitest'
import { formatAdjustment, formatObservedDate } from './format'

describe('presentation formatting', () => {
  it('shows observed Gregorian dates in the Persian calendar', () => {
    expect(formatObservedDate('2026-09-18')).toBe('۱۴۰۵/۰۶/۲۷')
    expect(formatObservedDate('2026-02-30')).toBe('نامشخص')
  })

  it('uses the same Persian skill levels as the filters', () => {
    expect(formatAdjustment('سطح rag از none به حداقل beginner برسد.')).toBe('سطح rag از بدون تجربه به حداقل مقدماتی برسد.')
    expect(formatAdjustment('سطح langchain از intermediate به حداقل advanced برسد.')).toBe('سطح langchain از متوسط به حداقل پیشرفته برسد.')
  })
})
