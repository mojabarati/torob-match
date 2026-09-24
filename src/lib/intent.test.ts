import { describe, expect, it } from 'vitest'
import dataset from '../../data/courses.json'
import intentScenarios from '../../data/intent-scenarios.json'
import sampleQuery from '../../data/sample-query.json'
import { analyzeSearchIntent, intentRelevance, normalizeIntent } from './intent'
import type { Course, SearchQuery } from './ranking'

const base = sampleQuery as SearchQuery
const courses = dataset.courses as Course[]

interface IntentScenario {
  id: string
  text: string
  expected: {
    supported: boolean
    signals: string[]
    budget: [number, number]
    hours: [number, number]
    deadline: [number, number]
    python?: string
    rag?: string
    project?: string
    evaluation?: string
    mentor?: string
    certificate?: string
  }
}

describe('search intent understanding', () => {
  it.each(intentScenarios as IntentScenario[])('matches the permanent scenario fixture: $id', ({ text, expected }) => {
    const result = analyzeSearchIntent(text, base)
    expect(result.supported).toBe(expected.supported)
    expect(result.signals).toEqual(expect.arrayContaining(expected.signals))
    expect(result.signals).toHaveLength(expected.signals.length)
    expect([result.query.budget.preferred_max_toman, result.query.budget.flexible_max_toman]).toEqual(expected.budget)
    expect([result.query.time.preferred_hours_per_week, result.query.time.flexible_hours_per_week]).toEqual(expected.hours)
    expect([result.query.time.preferred_deadline_weeks, result.query.time.flexible_deadline_weeks]).toEqual(expected.deadline)
    if (expected.python) expect(result.query.skills.python).toBe(expected.python)
    if (expected.rag) expect(result.query.skills.rag).toBe(expected.rag)
    if (expected.project) expect(result.query.priorities.hands_on_project).toBe(expected.project)
    if (expected.evaluation) expect(result.query.priorities.required_topics.evaluation).toBe(expected.evaluation)
    if (expected.mentor) expect(result.query.priorities.mentor_support).toBe(expected.mentor)
    if (expected.certificate) expect(result.query.priorities.certificate).toBe(expected.certificate)
  })

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
    expect(analyzeSearchIntent('دوره TypeScript برای فرانت‌اند، بودجه ۲ میلیون', base).supported).toBe(false)
  })

  it('makes a LangChain course more relevant for a LangChain search', () => {
    const analysis = analyzeSearchIntent('آموزش LangChain فارسی', base)
    const langchain = courses.find(course => course.id === 'jahani-langchain-fa')!
    const generic = courses.find(course => course.id === 'mftsk-llm-python')!
    expect(intentRelevance(langchain, analysis)).toBeGreaterThan(intentRelevance(generic, analysis))
  })

  it('normalizes Persian digits, written numbers, colloquial six and half spaces', () => {
    expect(normalizeIntent('تا ده تومن، هفته‌ای شیش ساعت، سه‌ماهه')).toBe('تا 10 تومن، هفته ای 6 ساعت، 3 ماهه')
  })

  it('extracts colloquial document search without guessing unrelated preferences', () => {
    const result = analyzeSearchIntent('برای ساخت سرچ هوشمند روی اسناد شرکت یه دوره می‌خوام، تا ده تومن، هفته‌ای شیش ساعت، سه‌ماهه', base)
    expect(result.supported).toBe(true)
    expect(result.signals).toContain('rag')
    expect(result.query.budget.flexible_max_toman).toBe(10_000_000)
    expect(result.query.time.preferred_hours_per_week).toBe(6)
    expect(result.query.time.preferred_deadline_weeks).toBe(12)
    expect(result.query.skills.python).toBe('intermediate')
    expect(result.query.priorities.hands_on_project).toBe('high')
  })

  it('gives explicit negation precedence over positive keywords', () => {
    const result = analyzeSearchIntent('RAG می‌خواهم اما پروژه عملی و منتور نمی‌خواهم؛ ارزیابی مهم نیست', base)
    expect(result.supported).toBe(true)
    expect(result.query.priorities.hands_on_project).toBe('none')
    expect(result.query.priorities.mentor_support).toBe('none')
    expect(result.query.priorities.required_topics.evaluation).toBe('none')
    expect(result.signals).not.toContain('project')
    expect(result.signals).not.toContain('mentor')
    expect(result.signals).not.toContain('evaluation')
  })

  it('understands free LangGraph courses, vector databases and practical work', () => {
    const result = analyzeSearchIntent('فقط دوره رایگان LangGraph با پروژه و پایگاه داده برداری', base)
    expect(result.supported).toBe(true)
    expect(result.signals).toEqual(expect.arrayContaining(['langgraph', 'vector_database', 'project']))
    expect(result.query.budget.preferred_max_toman).toBe(0)
    expect(result.query.budget.flexible_max_toman).toBe(0)
  })

  it('extracts explicit skill levels without inferring absent ones', () => {
    const result = analyzeSearchIntent('من Python مبتدی‌ام و RAG بلد نیستم؛ دوره عملی با evaluation می‌خواهم', base)
    expect(result.query.skills.python).toBe('beginner')
    expect(result.query.skills.rag).toBe('none')
    expect(result.query.priorities.hands_on_project).toBe('must')
    expect(result.query.priorities.required_topics.evaluation).toBe('must')
  })

  it('sorts reversed ranges and reports the normalization', () => {
    const result = analyzeSearchIntent('RAG عملی، بودجه ۱۰ تا ۵ میلیون، هفته‌ای ۸ تا ۴ ساعت، تا ۲ ماه', base)
    expect(result.query.budget.preferred_max_toman).toBe(5_000_000)
    expect(result.query.budget.flexible_max_toman).toBe(10_000_000)
    expect(result.query.time.preferred_hours_per_week).toBe(4)
    expect(result.query.time.flexible_hours_per_week).toBe(8)
    expect(result.query.time.preferred_deadline_weeks).toBe(8)
    expect(result.warnings).toHaveLength(2)
  })

  it('records deterministic provenance and evidence for extracted values', () => {
    const result = analyzeSearchIntent('RAG با بودجه ۳ تا ۸ میلیون', base)
    expect(result.usedEnhancer).toBe(false)
    expect(result.fields['budget.flexible_max_toman']).toMatchObject({
      value: 8_000_000,
      source: 'deterministic',
      confidence: 1,
    })
    expect(result.fields['budget.flexible_max_toman'].evidence).toContain('3 تا 8 میلیون')
    expect(result.fields['skills.python'].source).toBe('default')
  })
})
