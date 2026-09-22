export type Level = 'none' | 'beginner' | 'intermediate' | 'advanced'
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'must'
export type Group = 'current_matches' | 'flexible_matches' | 'stretch_options' | 'insufficient_data'
export type ConstraintState = 'preferred' | 'flexible' | 'stretch' | 'unknown'

export interface SearchQuery {
  id: string
  goal_fa: string
  persian_access_required: boolean
  budget: {
    control_min_toman: number
    control_max_toman: number
    control_step_toman: number
    preferred_max_toman: number
    flexible_max_toman: number
  }
  time: {
    preferred_deadline_weeks: number
    flexible_deadline_weeks: number
    preferred_hours_per_week: number
    flexible_hours_per_week: number
  }
  skills: Record<string, Level>
  priorities: {
    required_topics: Record<string, Priority>
    hands_on_project: Priority
    mentor_support: Priority
    certificate: Priority
  }
}

export interface Course {
  id: string
  title_fa: string
  provider: string
  source: { url: string; observed_at: string; source_type: string }
  localization: { teaching_language: string; subtitle_languages: string[]; persian_access: string }
  delivery: {
    mode: string
    total_hours: number | null
    duration_weeks: number | null
    hours_per_week: number | null
    rag_relevant_hours: number | null
    rag_module_independent: boolean | null
    access_model: string
    start_date_jalali: string | null
  }
  commercial: { price_toman: number | null; price_status: string; certificate: boolean | null }
  audience: {
    level: string
    skill_requirements: { skill: string; minimum_level: Level }[]
    prerequisites_fa: string[]
  }
  rag: { depth: string; topics: Record<string, boolean | null> }
  learning_experience: { hands_on_project: boolean | null; project_count: number | null; mentor_support: boolean | null }
  data_quality: { completeness: number; confidence: string; notes: string[] }
  evidence: { fields: string[]; summary_fa: string }[]
}

export interface RankedCourse {
  course_id: string
  title_fa: string
  provider: string
  source_url: string
  group: Group
  score: number
  score_components: Record<string, number>
  constraint_states: Record<string, ConstraintState>
  workload: { hours: number | null; scope: string }
  matched_required_topics: string[]
  unverified_required_topics: string[]
  missing_required_topics: string[]
  missing_skills: { skill: string; current_level: Level; required_level: Level }[]
  adjustments: string[]
  warnings: string[]
  gaps: string[]
  exact_match: boolean
}

export const GROUP_ORDER: Group[] = ['current_matches', 'flexible_matches', 'stretch_options', 'insufficient_data']
const WEIGHTS = { topic_fit: 35, practical_and_evaluation: 20, skill_fit: 15, time_fit: 10, budget_fit: 10, support_fit: 5, data_confidence: 5 }
const PRIORITY_FACTORS: Record<Priority, number> = { must: 1, high: .85, medium: .6, low: .25, none: 0 }
const SKILL_LEVELS: Record<Level, number> = { none: 0, beginner: 1, intermediate: 2, advanced: 3 }
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const money = (value: number) => `${new Intl.NumberFormat('en-US').format(value)} تومان`

export function validateQuery(query: SearchQuery): void {
  const b = query.budget
  if (b.control_min_toman !== 0 || b.control_max_toman !== 30_000_000 || b.preferred_max_toman < 0 || b.flexible_max_toman > 30_000_000 || b.preferred_max_toman > b.flexible_max_toman) {
    throw new Error('بودجهٔ مطلوب و منعطف باید در بازهٔ صفر تا ۳۰ میلیون مرتب باشند.')
  }
  const t = query.time
  if (Object.values(t).some(value => value <= 0) || t.preferred_deadline_weeks > t.flexible_deadline_weeks || t.preferred_hours_per_week > t.flexible_hours_per_week) {
    throw new Error('مهلت و ساعت منعطف باید از مقادیر مطلوب کمتر نباشند.')
  }
  if (Object.values(query.skills).some(level => !(level in SKILL_LEVELS))) throw new Error('سطح مهارت نامعتبر است.')
}

function rankOne(course: Course, query: SearchQuery): RankedCourse {
  const warnings: string[] = []
  const adjustments: string[] = []
  const gaps: string[] = []
  const states: Record<string, ConstraintState> = {}
  const components: Record<string, number> = {}

  const required = query.priorities.required_topics
  const requiredWeight = Object.values(required).reduce((sum, priority) => sum + PRIORITY_FACTORS[priority], 0) || 1
  const matched: string[] = []
  const unverified: string[] = []
  const missing: string[] = []
  for (const [topic, priority] of Object.entries(required)) {
    const covered = course.rag.topics[topic]
    if (covered === true) matched.push(topic)
    else if (covered === false) missing.push(topic)
    else unverified.push(topic)
    void priority
  }
  components.topic_fit = round2(WEIGHTS.topic_fit * matched.reduce((sum, topic) => sum + PRIORITY_FACTORS[required[topic]], 0) / requiredWeight)

  const projectFactor = PRIORITY_FACTORS[query.priorities.hands_on_project]
  const evaluationFactor = PRIORITY_FACTORS[required.evaluation || 'none']
  components.practical_and_evaluation = round2(
    (course.learning_experience.hands_on_project === true ? 12 * projectFactor : 0) +
    (course.rag.topics.evaluation === true ? 8 * evaluationFactor : 0),
  )
  if (course.learning_experience.hands_on_project === null && projectFactor) warnings.push('وجود پروژه‌ی عملی در اطلاعات عمومی مشخص نیست.')
  if (course.rag.topics.evaluation === null && evaluationFactor) warnings.push('پوشش عملی evaluation در اطلاعات عمومی قابل اثبات نیست.')

  const requirements = course.audience.skill_requirements
  const missingSkills: RankedCourse['missing_skills'] = []
  let met = 0
  for (const item of requirements) {
    const currentLevel = query.skills[item.skill] || 'none'
    if (SKILL_LEVELS[currentLevel] >= SKILL_LEVELS[item.minimum_level]) met++
    else missingSkills.push({ skill: item.skill, current_level: currentLevel, required_level: item.minimum_level })
  }
  components.skill_fit = requirements.length ? round2(WEIGHTS.skill_fit * met / requirements.length) : WEIGHTS.skill_fit
  states.skills = missingSkills.length ? 'stretch' : 'preferred'
  missingSkills.forEach(item => adjustments.push(`سطح ${item.skill} از ${item.current_level} به حداقل ${item.required_level} برسد.`))

  const hours = course.delivery.rag_module_independent === true && course.delivery.rag_relevant_hours !== null
    ? course.delivery.rag_relevant_hours : course.delivery.total_hours
  const workloadScope = course.delivery.rag_module_independent === true && course.delivery.rag_relevant_hours !== null ? 'rag_module' : 'full_course'
  const duration = course.delivery.duration_weeks
  const time = query.time
  if (hours === null) {
    states.time = 'unknown'
    components.time_fit = 5
    warnings.push('مدت قابل استفاده برای این هدف منتشر نشده است.')
  } else if (hours <= time.preferred_deadline_weeks * time.preferred_hours_per_week && (duration === null || duration <= time.preferred_deadline_weeks)) {
    states.time = 'preferred'
    components.time_fit = 10
  } else {
    const neededHours = Math.ceil(hours / time.preferred_deadline_weeks * 2) / 2
    const neededWeeks = Math.max(Math.ceil(hours / time.preferred_hours_per_week), duration === null ? 0 : Math.ceil(duration))
    if (hours <= time.flexible_deadline_weeks * time.flexible_hours_per_week && (duration === null || duration <= time.flexible_deadline_weeks)) {
      states.time = 'flexible'
      components.time_fit = 6
      if (neededHours <= time.flexible_hours_per_week && (duration === null || duration <= time.preferred_deadline_weeks)) {
        adjustments.push(`زمان هفتگی از ${time.preferred_hours_per_week} به حدود ${neededHours} ساعت افزایش یابد.`)
      } else adjustments.push(`مهلت از ${time.preferred_deadline_weeks} به حدود ${neededWeeks} هفته افزایش یابد.`)
    } else {
      states.time = 'stretch'
      components.time_fit = 0
      adjustments.push(`برای پایان در ${time.preferred_deadline_weeks} هفته، حدود ${neededHours} ساعت در هفته لازم است.`)
      adjustments.push(`با ${time.preferred_hours_per_week} ساعت در هفته، حدود ${neededWeeks} هفته لازم است.`)
    }
  }

  const price = course.commercial.price_toman
  const budget = query.budget
  if (price === null) {
    states.budget = 'unknown'
    components.budget_fit = 4
    warnings.push('قیمت عمومی نیست و برای سنجش تناسب بودجه باید استعلام شود.')
  } else if (price <= budget.preferred_max_toman) {
    states.budget = 'preferred'
    components.budget_fit = 10
  } else if (price <= budget.flexible_max_toman) {
    states.budget = 'flexible'
    components.budget_fit = round2(10 - 4 * (price - budget.preferred_max_toman) / Math.max(1, budget.flexible_max_toman - budget.preferred_max_toman))
    adjustments.push(`بودجه از مقدار مطلوب ${money(budget.preferred_max_toman)} تا ${money(price)} افزایش یابد.`)
  } else {
    states.budget = 'stretch'
    components.budget_fit = price <= budget.control_max_toman
      ? round2(Math.max(0, 4 * (1 - (price - budget.flexible_max_toman) / Math.max(1, budget.control_max_toman - budget.flexible_max_toman)))) : 0
    adjustments.push(price <= budget.control_max_toman
      ? `حد بودجه از ${money(budget.flexible_max_toman)} به حداقل ${money(price)} افزایش یابد.`
      : `قیمت ${money(price)} حتی از سقف کنترل ${money(budget.control_max_toman)} بیشتر است.`)
  }

  const supportFactor = PRIORITY_FACTORS[query.priorities.mentor_support]
  components.support_fit = course.learning_experience.mentor_support === true ? WEIGHTS.support_fit * supportFactor : 0
  if (course.learning_experience.mentor_support === null && supportFactor) warnings.push('دسترسی به منتور یا پشتیبان مشخص نیست.')
  components.data_confidence = round2(WEIGHTS.data_confidence * course.data_quality.completeness)
  states.persian_access = !query.persian_access_required || ['native', 'subtitled'].includes(course.localization.persian_access) ? 'preferred' : 'stretch'
  if (unverified.length) warnings.push(`پوشش این موضوع‌های ضروری در اطلاعات عمومی قابل اثبات نیست: ${unverified.join('، ')}`)
  if (missing.length) gaps.push(`موضوع‌های ضروری فاقد پوشش: ${missing.join('، ')}`)
  if (states.persian_access === 'stretch') gaps.push('دسترسی فارسی ندارد.')

  const group: Group = states.persian_access === 'stretch' || [states.budget, states.time, states.skills].includes('stretch')
    ? 'stretch_options' : [states.budget, states.time].includes('unknown') || [states.budget, states.time].includes('flexible')
      ? 'flexible_matches' : 'current_matches'
  const score = round2(Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)))
  return {
    course_id: course.id,
    title_fa: course.title_fa,
    provider: course.provider,
    source_url: course.source.url,
    group,
    score,
    score_components: components,
    constraint_states: states,
    workload: { hours, scope: workloadScope },
    matched_required_topics: matched,
    unverified_required_topics: unverified,
    missing_required_topics: missing,
    missing_skills: missingSkills,
    adjustments,
    warnings,
    gaps,
    exact_match: group === 'current_matches' && !unverified.length && !missing.length && !warnings.length && !gaps.length,
  }
}

export function rankCourses(courses: Course[], query: SearchQuery) {
  validateQuery(query)
  const groups: Record<Group, RankedCourse[]> = { current_matches: [], flexible_matches: [], stretch_options: [], insufficient_data: [] }
  for (const course of courses) {
    const ranked = rankOne(course, query)
    groups[ranked.group].push(ranked)
  }
  for (const group of GROUP_ORDER) groups[group].sort((a, b) => b.score - a.score || a.course_id.localeCompare(b.course_id))
  return {
    groups,
    summary: {
      input_courses: courses.length,
      visible_courses: GROUP_ORDER.reduce((sum, group) => sum + groups[group].length, 0),
      current_matches: groups.current_matches.length,
      flexible_matches: groups.flexible_matches.length,
      stretch_options: groups.stretch_options.length,
      insufficient_data: groups.insufficient_data.length,
      exact_matches: GROUP_ORDER.flatMap(group => groups[group]).filter(row => row.exact_match).length,
    },
  }
}
