import { describe, expect, it } from 'vitest'
import dataset from '../../data/courses.json'
import sampleQuery from '../../data/sample-query.json'
import { analyzeSearchIntent, intentRelevance } from './intent'
import type { Course, SearchQuery } from './ranking'

const base = sampleQuery as SearchQuery
const courses = dataset.courses as Course[]

describe('search intent understanding', () => {
  it('supports the current RAG domain and extracts dynamic constraints', () => {
    const result = analyzeSearchIntent('دوره پروژه‌محور RAG با بودجه ۳ تا ۸ میلیون و ۸ ساعت در هفته', base)
    expect(result.supported).toBe(true)
    expect(result.signals).toContain('project')
    expect(result.query.priorities.hands_on_project).toBe('must')
    expect(result.query.budget.preferred_max_toman).toBe(3_000_000)
    expect(result.query.budget.flexible_max_toman).toBe(8_000_000)
    expect(result.query.time.preferred_hours_per_week).toBe(8)
  })

  it('rejects topics outside the documented dataset', () => {
    expect(analyzeSearchIntent('دوره TypeScript برای فرانت‌اند', base).supported).toBe(false)
  })

  it('makes a LangChain course more relevant for a LangChain search', () => {
    const analysis = analyzeSearchIntent('آموزش LangChain فارسی', base)
    const langchain = courses.find(course => course.id === 'jahani-langchain-fa')!
    const generic = courses.find(course => course.id === 'mftsk-llm-python')!
    expect(intentRelevance(langchain, analysis)).toBeGreaterThan(intentRelevance(generic, analysis))
  })
})
