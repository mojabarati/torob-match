import type { Course, SearchQuery } from './ranking'

export type SearchSignal = 'rag' | 'langchain' | 'langgraph' | 'vector_database' | 'evaluation' | 'project' | 'mentor'

export interface SearchIntentAnalysis {
  supported: boolean
  normalized: string
  signals: SearchSignal[]
  query: SearchQuery
}

const toLatinDigits = (value: string) => value
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))

export const normalizeIntent = (value: string) => toLatinDigits(value)
  .toLocaleLowerCase('fa')
  .replace(/[ي]/g, 'ی')
  .replace(/[ك]/g, 'ک')
  .replace(/\s+/g, ' ')
  .trim()

const includesAny = (text: string, values: string[]) => values.some(value => text.includes(value))

const cloneQuery = (base: SearchQuery): SearchQuery => ({
  ...base,
  budget: { ...base.budget },
  time: { ...base.time },
  skills: { ...base.skills },
  priorities: {
    ...base.priorities,
    required_topics: { ...base.priorities.required_topics },
  },
})

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function analyzeSearchIntent(value: string, base: SearchQuery): SearchIntentAnalysis {
  const normalized = normalizeIntent(value)
  const query = cloneQuery(base)
  query.id = 'interactive-rag-search'
  query.goal_fa = value.trim() || base.goal_fa

  const signals: SearchSignal[] = []
  if (includesAny(normalized, ['rag', 'retrieval augmented', 'بازیابی افزوده', 'بازیابی تقویت'])) signals.push('rag')
  if (includesAny(normalized, ['langchain', 'لنگ‌چین', 'لنگ چین'])) signals.push('langchain')
  if (includesAny(normalized, ['langgraph', 'لنگ‌گراف', 'لنگ گراف'])) signals.push('langgraph')
  if (includesAny(normalized, ['vector database', 'vector db', 'پایگاه برداری', 'دیتابیس برداری'])) signals.push('vector_database')
  if (includesAny(normalized, ['evaluation', 'eval', 'ارزیابی'])) signals.push('evaluation')
  if (includesAny(normalized, ['پروژه', 'عملی', 'hands-on', 'hands on'])) signals.push('project')
  if (includesAny(normalized, ['منتور', 'مربی', 'پشتیبان'])) signals.push('mentor')

  if (signals.includes('evaluation')) query.priorities.required_topics.evaluation = 'must'
  if (signals.includes('vector_database')) query.priorities.required_topics.vector_database = 'must'
  if (signals.includes('project')) query.priorities.hands_on_project = 'must'
  if (signals.includes('mentor')) query.priorities.mentor_support = 'high'
  if (includesAny(normalized, ['مدرک مهم نیست', 'بدون مدرک'])) query.priorities.certificate = 'none'

  const budgetRange = normalized.match(/(\d+(?:\.\d+)?)\s*(?:تا|الی|-)\s*(\d+(?:\.\d+)?)\s*میلیون/)
  const budgetSingle = normalized.match(/(?:بودجه|حداکثر|تا سقف)?\s*(\d+(?:\.\d+)?)\s*میلیون/)
  if (includesAny(normalized, ['رایگان', 'مجانی'])) {
    query.budget.preferred_max_toman = 0
    query.budget.flexible_max_toman = 0
  } else if (budgetRange) {
    const first = clamp(Number(budgetRange[1]) * 1_000_000, 0, query.budget.control_max_toman)
    const second = clamp(Number(budgetRange[2]) * 1_000_000, 0, query.budget.control_max_toman)
    query.budget.preferred_max_toman = Math.min(first, second)
    query.budget.flexible_max_toman = Math.max(first, second)
  } else if (budgetSingle && includesAny(normalized, ['بودجه', 'حداکثر', 'تا سقف', 'تومان'])) {
    const amount = clamp(Number(budgetSingle[1]) * 1_000_000, 0, query.budget.control_max_toman)
    query.budget.preferred_max_toman = Math.min(query.budget.preferred_max_toman, amount)
    query.budget.flexible_max_toman = amount
  }

  const hoursRange = normalized.match(/(\d+(?:\.\d+)?)\s*(?:تا|الی|-)\s*(\d+(?:\.\d+)?)\s*ساعت/)
  const hoursSingle = normalized.match(/(\d+(?:\.\d+)?)\s*ساعت(?:\s*در\s*هفته|\/هفته)?/)
  if (hoursRange) {
    query.time.preferred_hours_per_week = Math.min(Number(hoursRange[1]), Number(hoursRange[2]))
    query.time.flexible_hours_per_week = Math.max(Number(hoursRange[1]), Number(hoursRange[2]))
  } else if (hoursSingle) {
    const hours = clamp(Number(hoursSingle[1]), 1, 50)
    query.time.preferred_hours_per_week = hours
    query.time.flexible_hours_per_week = Math.max(hours, query.time.flexible_hours_per_week)
  }

  const deadline = normalized.match(/(\d+(?:\.\d+)?)\s*(هفته|ماه)/)
  if (deadline) {
    const weeks = clamp(Math.round(Number(deadline[1]) * (deadline[2] === 'ماه' ? 4 : 1)), 1, 104)
    query.time.preferred_deadline_weeks = weeks
    query.time.flexible_deadline_weeks = Math.max(weeks, query.time.flexible_deadline_weeks)
  }

  if (includesAny(normalized, ['python مبتدی', 'پایتون مبتدی', 'تازه‌کار پایتون'])) query.skills.python = 'beginner'
  if (includesAny(normalized, ['python پیشرفته', 'پایتون پیشرفته'])) query.skills.python = 'advanced'

  const supported = signals.some(signal => ['rag', 'langchain', 'langgraph', 'vector_database'].includes(signal))
  return { supported, normalized, signals, query }
}

export function intentRelevance(course: Course, analysis: SearchIntentAnalysis): number {
  const title = normalizeIntent(course.title_fa)
  let score = 0
  if (analysis.signals.includes('langchain') && title.includes('langchain')) score += 45
  if (analysis.signals.includes('langgraph') && title.includes('langgraph')) score += 45
  if (analysis.signals.includes('vector_database') && course.rag.topics.vector_database === true) score += 25
  if (analysis.signals.includes('evaluation') && course.rag.topics.evaluation === true) score += 20
  if (analysis.signals.includes('project') && course.learning_experience.hands_on_project === true) score += 15
  if (analysis.signals.includes('mentor') && course.learning_experience.mentor_support === true) score += 10
  return score
}
