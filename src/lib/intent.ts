import { validateQuery, type Course, type Priority, type SearchQuery } from './ranking'

export type SearchSignal = 'rag' | 'langchain' | 'langgraph' | 'vector_database' | 'evaluation' | 'project' | 'mentor'
export type IntentFieldSource = 'deterministic' | 'llm' | 'default'

export interface IntentFieldState<T = unknown> {
  value: T
  source: IntentFieldSource
  confidence: number
  evidence?: string
}

export interface SearchIntentAnalysis {
  supported: boolean
  normalized: string
  signals: SearchSignal[]
  query: SearchQuery
  fields: Record<string, IntentFieldState>
  ambiguities: string[]
  warnings: string[]
  usedEnhancer: boolean
}

const NUMBER_WORDS: Record<string, number> = {
  صفر: 0,
  یک: 1,
  یه: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  شانزده: 16,
  هفده: 17,
  هجده: 18,
  نوزده: 19,
  بیست: 20,
  سی: 30,
  چهل: 40,
  پنجاه: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
  صد: 100,
}

const numberTokens = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')
const numberPhrase = new RegExp(`(?<![\\p{L}\\p{N}])(?:${numberTokens})(?:\\s+و\\s+(?:${numberTokens}))*(?![\\p{L}\\p{N}])`, 'gu')

const toLatinDigits = (value: string) => value
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))

const replacePersianNumberWords = (value: string) => value.replace(numberPhrase, phrase => {
  const total = phrase.split(/\s+و\s+/).reduce((sum, token) => sum + (NUMBER_WORDS[token] ?? 0), 0)
  return String(total)
})

export const normalizeIntent = (value: string) => replacePersianNumberWords(toLatinDigits(value)
  .toLocaleLowerCase('fa')
  .replace(/[يى]/g, 'ی')
  .replace(/[ك]/g, 'ک')
  .replace(/[ۀة]/g, 'ه')
  .replace(/[\u200c\u200d]/g, ' ')
  .replace(/نمی\s*خوام/g, 'نمی خواهم')
  .replace(/می\s*خوام/g, 'می خواهم')
  .replace(/هفته\s*ای/g, 'هفته ای')
  .replace(/\s+/g, ' ')
  .trim())

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

const defaultField = <T>(value: T): IntentFieldState<T> => ({ value, source: 'default', confidence: .5 })

const negatedNear = (text: string, terms: string[]) => terms.some(term => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}.{0,40}(?:نمی خواهم|لازم ندارم|نیاز ندارم|مهم نیست|ضروری نیست)`).test(text)
})

const budgetToToman = (amount: number, unit: string) => {
  if (unit.includes('میلیون') || amount <= 30) return amount * 1_000_000
  return amount
}

export function analyzeSearchIntent(value: string, base: SearchQuery): SearchIntentAnalysis {
  const normalized = normalizeIntent(value)
  const query = cloneQuery(base)
  query.id = 'interactive-rag-search'
  query.goal_fa = value.trim() || base.goal_fa

  const fields: Record<string, IntentFieldState> = {
    'budget.preferred_max_toman': defaultField(query.budget.preferred_max_toman),
    'budget.flexible_max_toman': defaultField(query.budget.flexible_max_toman),
    'time.preferred_hours_per_week': defaultField(query.time.preferred_hours_per_week),
    'time.flexible_hours_per_week': defaultField(query.time.flexible_hours_per_week),
    'time.preferred_deadline_weeks': defaultField(query.time.preferred_deadline_weeks),
    'time.flexible_deadline_weeks': defaultField(query.time.flexible_deadline_weeks),
    'skills.python': defaultField(query.skills.python),
    'skills.rag': defaultField(query.skills.rag),
    'priorities.hands_on_project': defaultField(query.priorities.hands_on_project),
    'priorities.mentor_support': defaultField(query.priorities.mentor_support),
    'priorities.certificate': defaultField(query.priorities.certificate),
    'priorities.required_topics.evaluation': defaultField(query.priorities.required_topics.evaluation),
  }
  const ambiguities: string[] = []
  const warnings: string[] = []
  const signals: SearchSignal[] = []
  const addSignal = (signal: SearchSignal) => {
    if (!signals.includes(signal)) signals.push(signal)
  }
  const setField = <T>(path: string, fieldValue: T, evidence: string, confidence = 1) => {
    fields[path] = { value: fieldValue, source: 'deterministic', confidence, evidence }
  }

  const documentSearch = /(?:سرچ|جست\s*وجو|پرسش\s*و\s*پاسخ).{0,28}(?:اسناد|مدارک|دانش\s*سازمانی)/.test(normalized)
    || includesAny(normalized, ['اسناد شرکت', 'دانش سازمانی'])
  const ragMentioned = includesAny(normalized, ['rag', 'retrieval augmented', 'بازیابی افزوده', 'بازیابی تقویت']) || documentSearch
  const langchainMentioned = includesAny(normalized, ['langchain', 'لنگ چین'])
  const langgraphMentioned = includesAny(normalized, ['langgraph', 'لنگ گراف'])
  const vectorMentioned = includesAny(normalized, ['vector database', 'vector db', 'پایگاه برداری', 'پایگاه داده برداری', 'دیتابیس برداری', 'دیتابیس وکتوری', 'وکتور دیتابیس'])

  if (ragMentioned) addSignal('rag')
  if (langchainMentioned) addSignal('langchain')
  if (langgraphMentioned) addSignal('langgraph')
  if (vectorMentioned) addSignal('vector_database')

  const evaluationTerms = ['evaluation', 'eval', 'ارزیابی', 'سنجش کیفیت']
  const projectTerms = ['پروژه', 'عملی', 'hands-on', 'hands on']
  const mentorTerms = ['منتور', 'مربی', 'پشتیبان']
  const evaluationMentioned = includesAny(normalized, evaluationTerms)
  const projectMentioned = includesAny(normalized, projectTerms)
  const mentorMentioned = includesAny(normalized, mentorTerms)
  const evaluationNegated = negatedNear(normalized, evaluationTerms)
  const projectNegated = negatedNear(normalized, projectTerms)
  const mentorNegated = negatedNear(normalized, mentorTerms)

  if (evaluationMentioned) {
    const priority: Priority = evaluationNegated ? 'none' : 'must'
    query.priorities.required_topics.evaluation = priority
    setField('priorities.required_topics.evaluation', priority, evaluationTerms.find(term => normalized.includes(term)) ?? 'evaluation')
    if (!evaluationNegated) addSignal('evaluation')
  }
  if (vectorMentioned) query.priorities.required_topics.vector_database = 'must'
  if (projectMentioned) {
    const priority: Priority = projectNegated ? 'none' : 'must'
    query.priorities.hands_on_project = priority
    setField('priorities.hands_on_project', priority, projectTerms.find(term => normalized.includes(term)) ?? 'پروژه')
    if (!projectNegated) addSignal('project')
  }
  if (mentorMentioned) {
    const priority: Priority = mentorNegated ? 'none' : 'high'
    query.priorities.mentor_support = priority
    setField('priorities.mentor_support', priority, mentorTerms.find(term => normalized.includes(term)) ?? 'منتور')
    if (!mentorNegated) addSignal('mentor')
  }

  const certificateNegative = negatedNear(normalized, ['مدرک', 'گواهی']) || includesAny(normalized, ['بدون مدرک', 'بدون گواهی'])
  if (certificateNegative) {
    query.priorities.certificate = 'none'
    setField('priorities.certificate', 'none', includesAny(normalized, ['مدرک']) ? 'مدرک' : 'گواهی')
  } else if (includesAny(normalized, ['مدرک مهم است', 'گواهی مهم است'])) {
    query.priorities.certificate = 'high'
    setField('priorities.certificate', 'high', includesAny(normalized, ['مدرک']) ? 'مدرک مهم است' : 'گواهی مهم است')
  }

  const budgetUnit = '(میلیون(?:\\s*(?:تومان|تومن))?|تومان|تومن)'
  const budgetRange = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:تا|الی|-)\\s*(\\d+(?:\\.\\d+)?)\\s*${budgetUnit}`))
  const budgetSingle = normalized.match(new RegExp(`(?:بودجه(?:\\s*ام)?|حداکثر(?:\\s*بودجه)?|تا\\s*سقف|تا)\\s*(\\d+(?:\\.\\d+)?)\\s*${budgetUnit}`))
    ?? normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${budgetUnit}`))
  if (includesAny(normalized, ['رایگان', 'مجانی'])) {
    query.budget.preferred_max_toman = 0
    query.budget.flexible_max_toman = 0
    setField('budget.preferred_max_toman', 0, includesAny(normalized, ['رایگان']) ? 'رایگان' : 'مجانی')
    setField('budget.flexible_max_toman', 0, includesAny(normalized, ['رایگان']) ? 'رایگان' : 'مجانی')
  } else if (budgetRange) {
    const first = clamp(budgetToToman(Number(budgetRange[1]), budgetRange[3]), 0, query.budget.control_max_toman)
    const second = clamp(budgetToToman(Number(budgetRange[2]), budgetRange[3]), 0, query.budget.control_max_toman)
    query.budget.preferred_max_toman = Math.min(first, second)
    query.budget.flexible_max_toman = Math.max(first, second)
    setField('budget.preferred_max_toman', query.budget.preferred_max_toman, budgetRange[0])
    setField('budget.flexible_max_toman', query.budget.flexible_max_toman, budgetRange[0])
    if (first > second) warnings.push('بازهٔ بودجه به‌ترتیب صعودی مرتب شد.')
  } else if (budgetSingle) {
    const amount = clamp(budgetToToman(Number(budgetSingle[1]), budgetSingle[2]), 0, query.budget.control_max_toman)
    query.budget.preferred_max_toman = Math.min(query.budget.preferred_max_toman, amount)
    query.budget.flexible_max_toman = amount
    setField('budget.preferred_max_toman', query.budget.preferred_max_toman, budgetSingle[0], .95)
    setField('budget.flexible_max_toman', amount, budgetSingle[0])
  } else if (includesAny(normalized, ['بودجه', 'تومان', 'تومن'])) {
    ambiguities.push('مقدار بودجه از متن قابل استخراج نیست.')
  }

  const hoursRange = normalized.match(/(\d+(?:\.\d+)?)\s*(?:تا|الی|-)\s*(\d+(?:\.\d+)?)\s*ساعت/)
  const hoursSingle = normalized.match(/(\d+(?:\.\d+)?)\s*ساعت(?:\s*(?:در\s*هفته|\/\s*هفته))?/)
  if (hoursRange) {
    const first = clamp(Number(hoursRange[1]), 1, 50)
    const second = clamp(Number(hoursRange[2]), 1, 50)
    query.time.preferred_hours_per_week = Math.min(first, second)
    query.time.flexible_hours_per_week = Math.max(first, second)
    setField('time.preferred_hours_per_week', query.time.preferred_hours_per_week, hoursRange[0])
    setField('time.flexible_hours_per_week', query.time.flexible_hours_per_week, hoursRange[0])
    if (first > second) warnings.push('بازهٔ ساعت هفتگی به‌ترتیب صعودی مرتب شد.')
  } else if (hoursSingle) {
    const hours = clamp(Number(hoursSingle[1]), 1, 50)
    query.time.preferred_hours_per_week = hours
    query.time.flexible_hours_per_week = Math.max(hours, query.time.flexible_hours_per_week)
    setField('time.preferred_hours_per_week', hours, hoursSingle[0])
    setField('time.flexible_hours_per_week', query.time.flexible_hours_per_week, hoursSingle[0], .95)
  } else if (normalized.includes('ساعت')) {
    ambiguities.push('زمان هفتگی از متن قابل استخراج نیست.')
  }

  const deadlineRange = normalized.match(/(\d+(?:\.\d+)?)\s*(?:تا|الی|-)\s*(\d+(?:\.\d+)?)\s*(هفته|ماه)/)
  const deadlineSingle = normalized.match(/(\d+(?:\.\d+)?)\s*(هفته|ماه)(?:\s*ه)?/)
  if (deadlineRange) {
    const multiplier = deadlineRange[3] === 'ماه' ? 4 : 1
    const first = clamp(Math.round(Number(deadlineRange[1]) * multiplier), 1, 104)
    const second = clamp(Math.round(Number(deadlineRange[2]) * multiplier), 1, 104)
    query.time.preferred_deadline_weeks = Math.min(first, second)
    query.time.flexible_deadline_weeks = Math.max(first, second)
    setField('time.preferred_deadline_weeks', query.time.preferred_deadline_weeks, deadlineRange[0])
    setField('time.flexible_deadline_weeks', query.time.flexible_deadline_weeks, deadlineRange[0])
    if (first > second) warnings.push('بازهٔ مهلت به‌ترتیب صعودی مرتب شد.')
  } else if (deadlineSingle) {
    const weeks = clamp(Math.round(Number(deadlineSingle[1]) * (deadlineSingle[2] === 'ماه' ? 4 : 1)), 1, 104)
    query.time.preferred_deadline_weeks = weeks
    query.time.flexible_deadline_weeks = Math.max(weeks, query.time.flexible_deadline_weeks)
    setField('time.preferred_deadline_weeks', weeks, deadlineSingle[0])
    setField('time.flexible_deadline_weeks', query.time.flexible_deadline_weeks, deadlineSingle[0], .95)
  }

  const pythonLevels: [string[], SearchQuery['skills'][string]][] = [
    [['python مبتدی', 'پایتون مبتدی', 'تازه کار پایتون'], 'beginner'],
    [['python متوسط', 'پایتون متوسط'], 'intermediate'],
    [['python پیشرفته', 'پایتون پیشرفته'], 'advanced'],
  ]
  for (const [terms, level] of pythonLevels) {
    const evidence = terms.find(term => normalized.includes(term))
    if (evidence) {
      query.skills.python = level
      setField('skills.python', level, evidence)
      break
    }
  }

  const ragNoExperience = /rag.{0,20}(?:بلد نیستم|تجربه ندارم|کار نکرده ام|آشنا نیستم)/.test(normalized)
  if (ragNoExperience) {
    query.skills.rag = 'none'
    setField('skills.rag', 'none', 'RAG … بلد نیستم')
  } else if (includesAny(normalized, ['rag مبتدی', 'تازه کار rag'])) {
    query.skills.rag = 'beginner'
    setField('skills.rag', 'beginner', 'RAG مبتدی')
  } else if (includesAny(normalized, ['rag متوسط'])) {
    query.skills.rag = 'intermediate'
    setField('skills.rag', 'intermediate', 'RAG متوسط')
  } else if (includesAny(normalized, ['rag پیشرفته'])) {
    query.skills.rag = 'advanced'
    setField('skills.rag', 'advanced', 'RAG پیشرفته')
  }

  const supported = signals.some(signal => ['rag', 'langchain', 'langgraph', 'vector_database'].includes(signal))
  validateQuery(query)
  return { supported, normalized, signals, query, fields, ambiguities, warnings, usedEnhancer: false }
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
