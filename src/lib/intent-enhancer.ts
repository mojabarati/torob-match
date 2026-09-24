import {
  analyzeSearchIntent,
  type IntentFieldState,
  type SearchIntentAnalysis,
} from './intent'
import {
  validateQuery,
  type Level,
  type Priority,
  type SearchQuery,
} from './ranking'
import enhancerOutputSchema from '../../data/intent-enhancer-schema.json'

export type EnhancerFieldPath =
  | 'budget.preferred_max_toman'
  | 'budget.flexible_max_toman'
  | 'time.preferred_hours_per_week'
  | 'time.flexible_hours_per_week'
  | 'time.preferred_deadline_weeks'
  | 'time.flexible_deadline_weeks'
  | 'skills.python'
  | 'skills.rag'
  | 'priorities.hands_on_project'
  | 'priorities.mentor_support'
  | 'priorities.certificate'
  | 'priorities.required_topics.evaluation'

export interface IntentEnhancerInput {
  rawText: string
  normalizedText: string
  ambiguities: string[]
  deterministicFields: Record<string, IntentFieldState>
}

export interface IntentEnhancerContext {
  signal: AbortSignal
}

export interface IntentEnhancer {
  readonly id: string
  enhance(input: IntentEnhancerInput, context: IntentEnhancerContext): Promise<unknown>
}

export interface EnhanceIntentOptions {
  timeoutMs?: number
}

export interface IntentEnhancerFieldSuggestion {
  value: unknown
  confidence?: number
  evidence?: string
}

export interface IntentEnhancerOutput {
  fields: Partial<Record<EnhancerFieldPath, IntentEnhancerFieldSuggestion>>
}

interface ValidSuggestion {
  path: EnhancerFieldPath
  value: number | Level | Priority
  confidence: number
  evidence?: string
}

const FIELD_PATHS = new Set<EnhancerFieldPath>([
  'budget.preferred_max_toman',
  'budget.flexible_max_toman',
  'time.preferred_hours_per_week',
  'time.flexible_hours_per_week',
  'time.preferred_deadline_weeks',
  'time.flexible_deadline_weeks',
  'skills.python',
  'skills.rag',
  'priorities.hands_on_project',
  'priorities.mentor_support',
  'priorities.certificate',
  'priorities.required_topics.evaluation',
])

const LEVELS = new Set<Level>(['none', 'beginner', 'intermediate', 'advanced'])
const PRIORITIES = new Set<Priority>(['none', 'low', 'medium', 'high', 'must'])
export const INTENT_ENHANCER_OUTPUT_SCHEMA = enhancerOutputSchema

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const cloneQuery = (query: SearchQuery): SearchQuery => ({
  ...query,
  budget: { ...query.budget },
  time: { ...query.time },
  skills: { ...query.skills },
  priorities: {
    ...query.priorities,
    required_topics: { ...query.priorities.required_topics },
  },
})

const validNumber = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
)

const isValidValue = (path: EnhancerFieldPath, value: unknown): value is number | Level | Priority => {
  if (path.startsWith('budget.')) return validNumber(value, 0, 30_000_000)
  if (path.includes('hours_per_week')) return validNumber(value, 1, 50)
  if (path.includes('deadline_weeks')) return validNumber(value, 1, 104)
  if (path.startsWith('skills.')) return typeof value === 'string' && LEVELS.has(value as Level)
  return typeof value === 'string' && PRIORITIES.has(value as Priority)
}

function parseEnhancerOutput(output: unknown): { suggestions: ValidSuggestion[]; warnings: string[] } {
  if (!isRecord(output) || !isRecord(output.fields)) {
    return { suggestions: [], warnings: ['خروجی بهبوددهنده با ساختار مورد انتظار مطابقت نداشت.'] }
  }

  const suggestions: ValidSuggestion[] = []
  const warnings: string[] = []
  for (const [rawPath, rawSuggestion] of Object.entries(output.fields)) {
    if (!FIELD_PATHS.has(rawPath as EnhancerFieldPath)) {
      warnings.push(`فیلد ناشناختهٔ «${rawPath}» از خروجی بهبوددهنده نادیده گرفته شد.`)
      continue
    }
    const path = rawPath as EnhancerFieldPath
    if (!isRecord(rawSuggestion) || !isValidValue(path, rawSuggestion.value)) {
      warnings.push(`مقدار پیشنهادی برای «${path}» معتبر نبود و نادیده گرفته شد.`)
      continue
    }
    const confidence = rawSuggestion.confidence === undefined ? .6 : rawSuggestion.confidence
    if (!validNumber(confidence, 0, 1)) {
      warnings.push(`میزان اطمینان «${path}» معتبر نبود و پیشنهاد نادیده گرفته شد.`)
      continue
    }
    const evidence = typeof rawSuggestion.evidence === 'string'
      ? rawSuggestion.evidence.trim().slice(0, 200)
      : undefined
    suggestions.push({
      path,
      value: rawSuggestion.value,
      confidence: Math.min(confidence, .85),
      ...(evidence ? { evidence } : {}),
    })
  }
  return { suggestions, warnings }
}

function setQueryField(query: SearchQuery, suggestion: ValidSuggestion) {
  const { path, value } = suggestion
  switch (path) {
    case 'budget.preferred_max_toman': query.budget.preferred_max_toman = value as number; break
    case 'budget.flexible_max_toman': query.budget.flexible_max_toman = value as number; break
    case 'time.preferred_hours_per_week': query.time.preferred_hours_per_week = value as number; break
    case 'time.flexible_hours_per_week': query.time.flexible_hours_per_week = value as number; break
    case 'time.preferred_deadline_weeks': query.time.preferred_deadline_weeks = value as number; break
    case 'time.flexible_deadline_weeks': query.time.flexible_deadline_weeks = value as number; break
    case 'skills.python': query.skills.python = value as Level; break
    case 'skills.rag': query.skills.rag = value as Level; break
    case 'priorities.hands_on_project': query.priorities.hands_on_project = value as Priority; break
    case 'priorities.mentor_support': query.priorities.mentor_support = value as Priority; break
    case 'priorities.certificate': query.priorities.certificate = value as Priority; break
    case 'priorities.required_topics.evaluation': query.priorities.required_topics.evaluation = value as Priority; break
  }
}

const removeResolvedAmbiguities = (ambiguities: string[], paths: EnhancerFieldPath[]) => ambiguities.filter(ambiguity => {
  if (ambiguity.includes('بودجه')) return !paths.some(path => path.startsWith('budget.'))
  if (ambiguity.includes('زمان هفتگی')) return !paths.some(path => path.includes('hours_per_week'))
  return true
})

export class NoopIntentEnhancer implements IntentEnhancer {
  readonly id = 'noop'

  async enhance(): Promise<unknown> {
    return { fields: {} }
  }
}

export async function enhanceSearchIntent(
  value: string,
  base: SearchQuery,
  enhancer?: IntentEnhancer,
  options: EnhanceIntentOptions = {},
): Promise<SearchIntentAnalysis> {
  const analysis = analyzeSearchIntent(value, base)
  if (!enhancer || analysis.ambiguities.length === 0) return analysis

  const timeoutMs = options.timeoutMs ?? 2_500
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  analysis.usedEnhancer = true

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('INTENT_ENHANCER_TIMEOUT'))
        controller.abort()
      }, timeoutMs)
    })
    const output = await Promise.race([
      enhancer.enhance({
        rawText: value,
        normalizedText: analysis.normalized,
        ambiguities: [...analysis.ambiguities],
        deterministicFields: { ...analysis.fields },
      }, { signal: controller.signal }),
      timeout,
    ])
    const parsed = parseEnhancerOutput(output)
    analysis.warnings.push(...parsed.warnings)

    const applicable = parsed.suggestions.filter(suggestion => {
      if (analysis.fields[suggestion.path]?.source === 'deterministic') {
        analysis.warnings.push(`پیشنهاد بهبوددهنده برای «${suggestion.path}» با مقدار قطعی جایگزین نشد.`)
        return false
      }
      return true
    })
    if (applicable.length === 0) return analysis

    const proposedQuery = cloneQuery(analysis.query)
    applicable.forEach(suggestion => setQueryField(proposedQuery, suggestion))
    try {
      validateQuery(proposedQuery)
    } catch {
      analysis.warnings.push('پیشنهادهای بهبوددهنده با محدودیت‌های جست‌وجو سازگار نبودند و اعمال نشدند.')
      return analysis
    }

    analysis.query = proposedQuery
    applicable.forEach(suggestion => {
      analysis.fields[suggestion.path] = {
        value: suggestion.value,
        source: 'llm',
        confidence: suggestion.confidence,
        ...(suggestion.evidence ? { evidence: suggestion.evidence } : {}),
      }
    })
    analysis.ambiguities = removeResolvedAmbiguities(analysis.ambiguities, applicable.map(item => item.path))
    return analysis
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'INTENT_ENHANCER_TIMEOUT'
    analysis.warnings.push(timedOut
      ? 'زمان پاسخ بهبوددهنده تمام شد؛ نتیجهٔ قطعی استفاده شد.'
      : 'بهبوددهنده در دسترس نبود؛ نتیجهٔ قطعی استفاده شد.')
    return analysis
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
