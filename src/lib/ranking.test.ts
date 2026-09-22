import { describe, expect, it } from 'vitest'
import dataset from '../../data/courses.json'
import sampleQuery from '../../data/sample-query.json'
import sampleRanking from '../../data/sample-ranking.json'
import { rankCourses, type Course, type SearchQuery } from './ranking'

const courses = dataset.courses as Course[]
const query = sampleQuery as SearchQuery
const withChanges = (changes: Partial<SearchQuery>): SearchQuery => ({
  ...query,
  ...changes,
  budget: { ...query.budget, ...changes.budget },
  time: { ...query.time, ...changes.time },
  skills: { ...query.skills, ...changes.skills },
})

describe('ranking parity with Python reference', () => {
  it('keeps all eight documented courses and matches reference groups and scores', () => {
    const result = rankCourses(courses, query)
    expect(result.summary).toEqual(sampleRanking.summary)
    for (const group of ['current_matches', 'flexible_matches', 'stretch_options'] as const) {
      expect(result.groups[group].map(({ course_id, score }) => ({ course_id, score })))
        .toEqual(sampleRanking.groups[group].map(({ course_id, score }) => ({ course_id, score })))
    }
  })

  it('moves the 15-million-toman course into the flexible group when budget expands', () => {
    const result = rankCourses(courses, withChanges({ budget: { ...query.budget, flexible_max_toman: 16_000_000 } }))
    expect(result.groups.flexible_matches.some(row => row.course_id === 'mftsk-llm-python')).toBe(true)
    expect(result.summary.visible_courses).toBe(8)
  })

  it('moves TehranData into the flexible group when time expands', () => {
    const result = rankCourses(courses, withChanges({ time: { ...query.time, flexible_deadline_weeks: 25 } }))
    expect(result.groups.flexible_matches.some(row => row.course_id === 'tehrandata-llm')).toBe(true)
  })

  it('unlocks skill-gated courses without hiding others', () => {
    const result = rankCourses(courses, withChanges({ skills: { ...query.skills, rag: 'beginner', langchain: 'beginner' } }))
    expect(result.groups.current_matches.some(row => row.course_id === 'udemyiran-advanced-rag')).toBe(true)
    expect(result.groups.current_matches.some(row => row.course_id === 'udemyiran-langgraph')).toBe(true)
    expect(result.summary.visible_courses).toBe(8)
  })

  it('rejects a budget above the product range', () => {
    expect(() => rankCourses(courses, withChanges({ budget: { ...query.budget, flexible_max_toman: 31_000_000 } }))).toThrow()
  })
})
