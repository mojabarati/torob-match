import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft, ArrowUpLeft, Bookmark, Check, CheckCircle2, ChevronDown, CircleAlert,
  Clock3, Filter, Heart, Info, Menu, Moon, Search, SlidersHorizontal,
  Sparkles, Sun, X,
} from 'lucide-react'
import dataset from '../data/courses.json'
import sampleQuery from '../data/sample-query.json'
import { formatAdjustment, formatObservedDate } from './lib/format'
import { analyzeSearchIntent, intentRelevance, type SearchIntentAnalysis } from './lib/intent'
import { enhanceSearchIntent } from './lib/intent-enhancer'
import { createConfiguredIntentEnhancer, getConfiguredIntentEnhancerTimeout } from './lib/http-intent-enhancer'
import { GROUP_ORDER, rankCourses, type Course, type Group, type Level, type RankedCourse, type SearchQuery } from './lib/ranking'

const courses = dataset.courses as Course[]
const initialQuery = sampleQuery as SearchQuery
const courseById = new Map(courses.map(course => [course.id, course]))
const groupName: Record<Group, string> = {
  current_matches: 'مناسب شرایط فعلی',
  flexible_matches: 'با کمی انعطاف',
  stretch_options: 'نیازمند تغییر بیشتر',
  insufficient_data: 'دادهٔ ناکافی',
}
const levelName: Record<Level, string> = { none: 'بدون تجربه', beginner: 'مقدماتی', intermediate: 'متوسط', advanced: 'پیشرفته' }
const groupTone: Record<Group, string> = { current_matches: 'success', flexible_matches: 'warning', stretch_options: 'stretch', insufficient_data: 'neutral' }
const asPersianNumber = (value: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value)
const formatPrice = (price: number | null) => price === null ? 'نیازمند استعلام' : price === 0 ? 'رایگان' : `${asPersianNumber(price)} تومان`
const million = (value: number) => `${asPersianNumber(value / 1_000_000)} میلیون`
const scrollToTop = () => { if (!navigator.userAgent.includes('jsdom')) window.scrollTo({ top: 0 }) }

function usePersistentIds(key: string) {
  const [ids, setIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') as string[] } catch { return [] }
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(ids)) }, [ids, key])
  return [ids, setIds] as const
}

type Theme = 'light' | 'dark'
type View = 'home' | 'results'
type EnhancerStatus = 'idle' | 'loading' | 'enhanced' | 'fallback'

const getView = (): View => window.location.pathname.startsWith('/search') ? 'results' : 'home'
const getIntent = () => new URLSearchParams(window.location.search).get('q')?.trim() || 'ساخت RAG با پایتون'

function Logo({ onClick, large = false, showText = false }: { onClick?: () => void; large?: boolean; showText?: boolean }) {
  const content = <>
    {large ? <span className="brand-lockup-frame" aria-hidden="true"><img className="brand-lockup" src="/brand/torob-match-logo.png" alt="" /></span> : <>
      <span className="brand-assets" aria-hidden="true"><img className="brand-icon" src="/brand/torob-match-icon.png" alt="" /></span>
      {showText && <span className="brand-text"><strong>ترب مچ</strong><small>دوره‌ای که بهت میاد</small></span>}
    </>}
  </>
  if (!onClick) return <div className={`brand ${large ? 'brand-large' : ''}`} aria-label="ترب مچ">{content}</div>
  return <button type="button" className={`brand ${large ? 'brand-large' : ''}`} aria-label="ترب مچ؛ بازگشت به صفحهٔ اصلی" onClick={onClick}>{content}</button>
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'light' ? 'تیره' : 'روشن'
  return <button type="button" className="theme-toggle" onClick={onToggle} aria-label={`فعال‌کردن حالت ${next}`} title={`حالت ${next}`}>
    {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
  </button>
}

function HomePage({ theme, intent, onIntentChange, onSearch, onToggleTheme }: {
  theme: Theme
  intent: string
  onIntentChange: (value: string) => void
  onSearch: (value: string) => void
  onToggleTheme: () => void
}) {
  const suggestions = ['ساخت RAG با پایتون', 'آموزش LangChain فارسی', 'دورهٔ RAG پروژه‌محور']
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (intent.trim()) onSearch(intent.trim())
  }
  return <div className="home-shell">
    <header className="home-header"><div className="home-header-inner"><Logo showText onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /><div className="home-actions"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div></div></header>
    <main className="home-main">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-glow home-glow-one" aria-hidden="true" /><div className="home-glow home-glow-two" aria-hidden="true" />
        <Logo large />
        <span className="home-eyebrow"><Sparkles size={17} /> جست‌وجوی دوره با معیارهای واقعی تو</span>
        <h1 id="home-title">دوره‌ای را پیدا کن که واقعاً<br /><em>به شرایطت می‌خورد</em></h1>
        <p>هدفت را بنویس؛ ترب مچ گزینه‌ها را با بودجه، زمان، مهارت و کیفیت داده مقایسه می‌کند و دلیل هر پیشنهاد را شفاف نشان می‌دهد.</p>
        <form className="home-search" onSubmit={submit} role="search">
          <Search size={23} aria-hidden="true" />
          <input autoFocus aria-label="چه چیزی می‌خواهی یاد بگیری؟" value={intent} onChange={event => onIntentChange(event.target.value)} placeholder="مثلاً می‌خواهم RAG را با پایتون به محصول اضافه کنم" />
          <button type="submit">جست‌وجو <ArrowLeft size={19} /></button>
        </form>
        <div className="home-suggestions"><span>جست‌وجوهای پیشنهادی:</span>{suggestions.map(item => <button key={item} type="button" onClick={() => { onIntentChange(item); onSearch(item) }}>{item}</button>)}</div>
      </section>
      <p className="home-scope"><Info size={15} /> نسخهٔ فعلی روی دوره‌های مستند RAG و Python تمرکز دارد و برای نمایش مفهوم محصول ساخته شده است.</p>
    </main>
  </div>
}

function UnsupportedState({ intent, onTrySupported, onHome }: { intent: string; onTrySupported: () => void; onHome: () => void }) {
  return <main className="page-container unsupported-page">
    <div className="breadcrumb">خانه <span>/</span> نتایج جست‌وجو</div>
    <section className="unsupported-card" aria-labelledby="unsupported-title">
      <span className="unsupported-icon"><Search size={28} /></span>
      <span className="eyebrow">پاسخ صادقانه به‌جای نتیجهٔ ساختگی</span>
      <h1 id="unsupported-title">فعلاً برای <em><bdi dir="rtl">{intent}</bdi></em> دادهٔ کافی نداریم</h1>
      <p>مجموعهٔ مستند این نسخه روی RAG، LangChain، LangGraph و پایگاه دادهٔ برداری با Python تمرکز دارد. برای موضوع‌های دیگر هنوز دورهٔ کافی و قابل‌مقایسه گردآوری نشده است.</p>
      <div className="unsupported-actions">
        <button className="primary-button" type="button" onClick={onTrySupported}>جست‌وجوی RAG با پایتون <ArrowLeft size={17} /></button>
        <button className="outline-button" type="button" onClick={onHome}>بازگشت و ویرایش جست‌وجو</button>
      </div>
      <div className="unsupported-scope"><Info size={16} /><span>این محدودیت به معنی نبود دوره در بازار نیست؛ فقط یعنی ترب مچ برای رتبه‌بندی قابل‌اعتماد آن هنوز دادهٔ کافی ندارد.</span></div>
    </section>
  </main>
}

function DualRangeField({ name, min, max, step, lower, upper, lowerLabel, upperLabel, format, onLowerChange, onUpperChange }: {
  name: string
  min: number
  max: number
  step: number
  lower: number
  upper: number
  lowerLabel: string
  upperLabel: string
  format: (value: number) => string
  onLowerChange: (value: number) => void
  onUpperChange: (value: number) => void
}) {
  const start = (lower - min) / (max - min) * 100
  const end = (upper - min) / (max - min) * 100
  const trackStyle = { '--range-start': `${start}%`, '--range-end': `${end}%` } as CSSProperties

  return <div className="dual-range-field" role="group" aria-label={name}>
    <div className="dual-range-values"><div><span>{lowerLabel}</span><strong><bdi dir="rtl">{format(lower)}</bdi></strong></div><div><span>{upperLabel}</span><strong><bdi dir="rtl">{format(upper)}</bdi></strong></div></div>
    <div className="dual-range-control" style={trackStyle}>
      <div className="dual-range-track" aria-hidden="true" />
      <div className="dual-range-selected" aria-hidden="true" />
      <input className="dual-range-input lower" aria-label={lowerLabel} aria-valuetext={format(lower)} type="range" min={min} max={max} step={step} value={lower} onChange={event => onLowerChange(Math.min(Number(event.target.value), upper))} />
      <input className="dual-range-input upper" aria-label={upperLabel} aria-valuetext={format(upper)} type="range" min={min} max={max} step={step} value={upper} onChange={event => onUpperChange(Math.max(Number(event.target.value), lower))} />
    </div>
    <div className="range-ends"><span><bdi dir="rtl">{format(min)}</bdi></span><span><bdi dir="rtl">{format(max)}</bdi></span></div>
  </div>
}

type FilterPanelProps = {
  query: SearchQuery
  onChange: (query: SearchQuery) => void
  onReset: () => void
  onClose?: () => void
  onShow?: () => void
  count: number
}

function FilterPanel({ query, onChange, onReset, onClose, onShow, count }: FilterPanelProps) {
  const updateBudget = (key: 'preferred_max_toman' | 'flexible_max_toman', value: number) => {
    const budget = { ...query.budget, [key]: key === 'preferred_max_toman' ? Math.min(value, query.budget.flexible_max_toman) : Math.max(value, query.budget.preferred_max_toman) }
    onChange({ ...query, budget })
  }
  const updateTime = (key: keyof SearchQuery['time'], value: number) => {
    const counterpart = key === 'preferred_hours_per_week' ? query.time.flexible_hours_per_week
      : key === 'flexible_hours_per_week' ? query.time.preferred_hours_per_week
        : key === 'preferred_deadline_weeks' ? query.time.flexible_deadline_weeks : query.time.preferred_deadline_weeks
    const bounded = key.startsWith('preferred_') ? Math.min(value, counterpart) : Math.max(value, counterpart)
    const time = { ...query.time, [key]: bounded }
    onChange({ ...query, time })
  }
  const updateSkill = (skill: string, value: Level) => onChange({ ...query, skills: { ...query.skills, [skill]: value } })
  const updatePriority = (key: 'hands_on_project' | 'mentor_support', checked: boolean) => onChange({
    ...query, priorities: { ...query.priorities, [key]: checked ? 'high' : 'none' },
  })
  const updateEvaluation = (checked: boolean) => onChange({
    ...query, priorities: { ...query.priorities, required_topics: { ...query.priorities.required_topics, evaluation: checked ? 'must' : 'none' } },
  })

  return <aside className="filter-panel" aria-label="فیلتر و انعطاف">
    <div className="filter-heading"><div><SlidersHorizontal size={19} /><strong>فیلتر و انعطاف</strong></div><div className="filter-actions"><button className="text-button" onClick={onReset}>بازنشانی</button>{onClose && <button className="icon-button close-mobile" aria-label="بستن فیلترها" onClick={onClose}><X size={19} /></button>}</div></div>
    <div className="filter-content" tabIndex={0} aria-label="تنظیمات فیلتر؛ برای دیدن همهٔ موارد پیمایش کنید"><div className="filter-section">
      <div className="section-heading"><span>بودجهٔ یادگیری</span><span className="section-hint">۰ تا ۳۰ میلیون تومان</span></div>
      <DualRangeField name="بازهٔ بودجه" min={0} max={30_000_000} step={500_000} lower={query.budget.preferred_max_toman} upper={query.budget.flexible_max_toman} lowerLabel="حداقل بودجه" upperLabel="حداکثر بودجه" format={million} onLowerChange={value => updateBudget('preferred_max_toman', value)} onUpperChange={value => updateBudget('flexible_max_toman', value)} />
    </div>
    <div className="filter-section"><div className="section-heading">زمانی که در اختیار داری</div>
      <DualRangeField name="بازهٔ ساعت هفتگی" min={1} max={50} step={1} lower={query.time.preferred_hours_per_week} upper={query.time.flexible_hours_per_week} lowerLabel="حداقل ساعت در هفته" upperLabel="حداکثر ساعت در هفته" format={value => `${asPersianNumber(value)} ساعت`} onLowerChange={value => updateTime('preferred_hours_per_week', value)} onUpperChange={value => updateTime('flexible_hours_per_week', value)} />
      <DualRangeField name="بازهٔ مهلت" min={1} max={104} step={1} lower={query.time.preferred_deadline_weeks} upper={query.time.flexible_deadline_weeks} lowerLabel="حداقل مهلت مطلوب" upperLabel="حداکثر مهلت مطلوب" format={value => `${asPersianNumber(value)} هفته`} onLowerChange={value => updateTime('preferred_deadline_weeks', value)} onUpperChange={value => updateTime('flexible_deadline_weeks', value)} />
    </div>
    <div className="filter-section"><div className="section-heading">سطح مهارت فعلی</div>
      <label className="select-field full">Python<select aria-label="سطح Python" value={query.skills.python} onChange={event => updateSkill('python', event.target.value as Level)}>{Object.entries(levelName).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="select-field full">RAG<select aria-label="سطح RAG" value={query.skills.rag} onChange={event => updateSkill('rag', event.target.value as Level)}>{Object.entries(levelName).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="select-field full">LangChain<select aria-label="سطح LangChain" value={query.skills.langchain} onChange={event => updateSkill('langchain', event.target.value as Level)}>{Object.entries(levelName).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    <div className="filter-section priority-section"><div className="section-heading">برایم مهم است</div>
      <label className="check-row"><span>پروژهٔ عملی</span><input type="checkbox" checked={query.priorities.hands_on_project !== 'none'} onChange={event => updatePriority('hands_on_project', event.target.checked)} /></label>
      <label className="check-row"><span>پوشش Evaluation</span><input type="checkbox" checked={query.priorities.required_topics.evaluation !== 'none'} onChange={event => updateEvaluation(event.target.checked)} /></label>
      <label className="check-row"><span>پشتیبانی مدرس</span><input type="checkbox" checked={query.priorities.mentor_support !== 'none'} onChange={event => updatePriority('mentor_support', event.target.checked)} /></label>
    </div></div>
    <div className="filter-foot"><button className="primary-button full" onClick={onShow ?? onClose}>نمایش {asPersianNumber(count)} دوره <ArrowLeft size={17} /></button><p>همهٔ دوره‌ها می‌مانند؛ فقط رتبه و دلیل تناسب به‌روز می‌شود.</p></div>
  </aside>
}

function CourseCard({ row, course, index, selected, saved, onCompare, onSave, featured }: {
  row: RankedCourse; course: Course; index: number; selected: boolean; saved: boolean; onCompare: () => void; onSave: () => void; featured: boolean
}) {
  const positive = [
    row.matched_required_topics.includes('rag_foundations') && 'مبانی RAG در سرفصل دوره تأیید شده است.',
    course.learning_experience.hands_on_project === true && 'پروژهٔ عملی در اطلاعات دوره ذکر شده است.',
    row.constraint_states.time === 'preferred' && 'با حداقل زمان هفتگی و مهلت شما سازگار است.',
    row.constraint_states.budget === 'preferred' && 'با حداقل بودجهٔ شما سازگار است.',
  ].filter(Boolean).slice(0, featured ? 3 : 2) as string[]
  const mainWarning = row.warnings.find(text => text.includes('evaluation')) || row.warnings[0]
  const price = course.commercial.price_toman
  return <article className={`course-card ${featured ? 'featured' : ''} tone-${groupTone[row.group]}`} data-testid={`course-${course.id}`}>
    <span className="rank-badge" aria-label={`رتبهٔ ${asPersianNumber(index)}`}>{asPersianNumber(index)}</span>
    <div className="card-topline"><span className={`status-chip tone-${groupTone[row.group]}`}><span className="status-dot" />{groupName[row.group]}</span><div className="card-top-actions"><button className={`icon-button save-button ${saved ? 'is-saved' : ''}`} aria-label={saved ? `حذف ${course.title_fa} از ذخیره‌شده‌ها` : `ذخیره ${course.title_fa}`} aria-pressed={saved} onClick={onSave}><Heart size={19} fill={saved ? 'currentColor' : 'none'} /></button></div></div>
    <div className="card-head"><div className="card-head-main"><h3>{course.title_fa}</h3><p>{course.provider} <span>·</span> {course.localization.persian_access === 'native' ? 'آموزش فارسی' : 'با زیرنویس فارسی'} <span>·</span> {course.delivery.mode === 'instructor_led' ? 'مدرس‌محور' : 'یادگیری منعطف'}</p></div><div className="score-badge"><strong>{asPersianNumber(row.score)}</strong><span>از ۱۰۰</span></div></div>
    <div className="card-facts"><div><span>شهریهٔ مشاهده‌شده</span><strong>{formatPrice(price)}</strong></div><div><span>مدت محتوای مرتبط</span><strong>{row.workload.hours === null ? 'نامشخص' : `${asPersianNumber(row.workload.hours)} ساعت`}</strong></div><div><span>پروژهٔ عملی</span><strong>{course.learning_experience.hands_on_project === true ? 'تأییدشده' : 'نامشخص'}</strong></div><div><span>Evaluation</span><strong>{course.rag.topics.evaluation === true ? 'تأییدشده' : course.rag.topics.evaluation === false ? 'ذکر نشده' : 'اثبات‌نشده'}</strong></div></div>
    {featured && <div className="reason-box"><div className="mini-heading"><Sparkles size={16} /> چرا پیشنهاد شده؟</div><ul>{positive.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {!featured && <p className="short-reason"><CheckCircle2 size={16} />{positive[0] || 'جزئیات این دوره برای مقایسه در دسترس است.'}</p>}
    {row.adjustments.length > 0 && <div className="adjustment"><Info size={17} /><span><strong>برای تناسب بیشتر:</strong> {formatAdjustment(row.adjustments[0])}</span></div>}
    {mainWarning && <div className="warning-line"><CircleAlert size={17} /><span>{mainWarning}</span></div>}
    <div className="card-bottom"><div className="card-meta"><span><Clock3 size={14} /> دادهٔ بررسی‌شده: {formatObservedDate(course.source.observed_at)}</span><span>اعتبار داده: {course.data_quality.confidence === 'high' ? 'بالا' : 'متوسط'}</span></div><div className="card-buttons"><button className={`outline-button compare-button ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onCompare}>{selected ? <Check size={16} /> : <span className="plus-box">+</span>}{selected ? 'در مقایسه' : 'افزودن به مقایسه'}</button><a className="source-button" href={course.source.url} target="_blank" rel="noopener noreferrer" aria-label={`مشاهدهٔ منبع ${course.title_fa} در سایت برگزارکننده`}>مشاهدهٔ دوره <ArrowUpLeft size={16} /></a></div></div>
  </article>
}

function CompareDialog({ ids, rows, onClose, onRemove }: { ids: string[]; rows: RankedCourse[]; onClose: () => void; onRemove: (id: string) => void }) {
  const chosen = ids.map(id => ({ course: courseById.get(id)!, row: rows.find(row => row.course_id === id)! })).filter(item => item.course && item.row)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title"><div className="modal-heading"><div><span className="eyebrow">تصمیم با اطلاعات روشن‌تر</span><h2 id="compare-title">مقایسهٔ کنارهمی دوره‌ها</h2></div><button className="icon-button" aria-label="بستن مقایسه" onClick={onClose}><X size={21} /></button></div><div className="compare-scroll"><table><thead><tr><th scope="col">معیار</th>{chosen.map(({ course }) => <th scope="col" key={course.id}><span>{course.title_fa}</span><button className="table-remove" aria-label={`حذف ${course.title_fa} از مقایسه`} onClick={() => onRemove(course.id)}><X size={15} /></button></th>)}</tr></thead><tbody><tr><th scope="row">امتیاز تناسب</th>{chosen.map(({ course, row }) => <td key={course.id}><strong className="table-score">{asPersianNumber(row.score)} / ۱۰۰</strong></td>)}</tr><tr><th scope="row">وضعیت</th>{chosen.map(({ course, row }) => <td key={course.id}>{groupName[row.group]}</td>)}</tr><tr><th scope="row">شهریه</th>{chosen.map(({ course }) => <td key={course.id}>{formatPrice(course.commercial.price_toman)}</td>)}</tr><tr><th scope="row">مدت مرتبط</th>{chosen.map(({ course, row }) => <td key={course.id}>{row.workload.hours === null ? 'نامشخص' : `${asPersianNumber(row.workload.hours)} ساعت`}</td>)}</tr><tr><th scope="row">پروژهٔ عملی</th>{chosen.map(({ course }) => <td key={course.id}>{course.learning_experience.hands_on_project === true ? 'تأییدشده' : 'نامشخص'}</td>)}</tr><tr><th scope="row">Evaluation</th>{chosen.map(({ course }) => <td key={course.id}>{course.rag.topics.evaluation === true ? 'تأییدشده' : 'در منبع عمومی اثبات نشده'}</td>)}</tr><tr><th scope="row">تغییر لازم</th>{chosen.map(({ course, row }) => <td key={course.id}>{row.adjustments[0] ? formatAdjustment(row.adjustments[0]) : 'نیاز به تغییر ندارد'}</td>)}</tr></tbody></table></div><p className="modal-note"><Info size={16} /> قیمت و جزئیات از صفحات عمومی در تاریخ ثبت داده استخراج شده‌اند؛ پیش از ثبت‌نام از برگزارکننده بررسی کنید.</p></div></div>
}

export default function App() {
  const desktopFiltersRef = useRef<HTMLDivElement>(null)
  const searchRequestRef = useRef(0)
  const [intentEnhancer] = useState(createConfiguredIntentEnhancer)
  const [intentEnhancerTimeout] = useState(getConfiguredIntentEnhancerTimeout)
  const [view, setView] = useState<View>(getView)
  const [intent, setIntent] = useState(getIntent)
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('torob-match:theme')
    if (stored === 'light' || stored === 'dark') return stored
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [intentAnalysis, setIntentAnalysis] = useState<SearchIntentAnalysis>(() => analyzeSearchIntent(getIntent(), initialQuery))
  const [query, setQuery] = useState<SearchQuery>(() => analyzeSearchIntent(getIntent(), initialQuery).query)
  const [enhancerStatus, setEnhancerStatus] = useState<EnhancerStatus>('idle')
  const [search, setSearch] = useState(getIntent)
  const [group, setGroup] = useState<Group | 'all'>('all')
  const [sort, setSort] = useState('recommended')
  const [mobileFilters, setMobileFilters] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [savedIds, setSavedIds] = usePersistentIds('torob-match:saved')
  const ranked = useMemo(() => rankCourses(courses, query), [query])
  const allRows = useMemo(() => GROUP_ORDER.flatMap(key => ranked.groups[key]), [ranked])
  const searchFiltered = allRows
  const counts = useMemo(() => Object.fromEntries(GROUP_ORDER.map(key => [key, searchFiltered.filter(row => row.group === key).length])) as Record<Group, number>, [searchFiltered])
  const shown = useMemo(() => {
    const rows = searchFiltered.filter(row => group === 'all' || row.group === group)
    if (sort === 'price') rows.sort((a, b) => (courseById.get(a.course_id)!.commercial.price_toman ?? Infinity) - (courseById.get(b.course_id)!.commercial.price_toman ?? Infinity))
    else if (sort === 'duration') rows.sort((a, b) => (a.workload.hours ?? Infinity) - (b.workload.hours ?? Infinity))
    else rows.sort((a, b) => intentRelevance(courseById.get(b.course_id)!, intentAnalysis) - intentRelevance(courseById.get(a.course_id)!, intentAnalysis) || b.score - a.score)
    return rows
  }, [searchFiltered, group, sort, intentAnalysis])
  const recommendedCurrent = [...ranked.groups.current_matches]
    .sort((a, b) => intentRelevance(courseById.get(b.course_id)!, intentAnalysis) - intentRelevance(courseById.get(a.course_id)!, intentAnalysis) || b.score - a.score)
  const featuredIds = new Set(recommendedCurrent.slice(0, 3).map(row => row.course_id))
  const evaluationImportant = query.priorities.required_topics.evaluation !== 'none'
  const topCandidates = recommendedCurrent.slice(0, 3)
  const unverifiedEvaluationCount = topCandidates.filter(row => courseById.get(row.course_id)?.rag.topics.evaluation !== true).length
  const toggleCompare = (id: string) => setCompareIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 3 ? [...current, id] : current)
  const toggleSaved = (id: string) => setSavedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const goHome = () => {
    searchRequestRef.current += 1
    setEnhancerStatus('idle')
    window.history.pushState({}, '', '/')
    setView('home')
    scrollToTop()
  }
  const applyManualQuery = (nextQuery: SearchQuery) => {
    searchRequestRef.current += 1
    setEnhancerStatus('idle')
    setQuery(nextQuery)
  }
  const showResults = async (value: string) => {
    const clean = value.trim() || 'ساخت RAG با پایتون'
    const analysis = analyzeSearchIntent(clean, initialQuery)
    const requestId = ++searchRequestRef.current
    setIntent(clean)
    setSearch(clean)
    setIntentAnalysis(analysis)
    setQuery(analysis.query)
    setEnhancerStatus('idle')
    setGroup('all')
    setSort('recommended')
    window.history.pushState({}, '', `/search?q=${encodeURIComponent(clean)}`)
    setView('results')
    scrollToTop()
    if (!intentEnhancer || analysis.ambiguities.length === 0) return

    setEnhancerStatus('loading')
    const enhanced = await enhanceSearchIntent(clean, initialQuery, intentEnhancer, { timeoutMs: intentEnhancerTimeout })
    if (requestId !== searchRequestRef.current) return
    setIntentAnalysis(enhanced)
    setQuery(enhanced.query)
    const applied = Object.values(enhanced.fields).some(field => field.source === 'llm')
    setEnhancerStatus(applied ? 'enhanced' : 'fallback')
  }
  const toggleTheme = () => setTheme(current => current === 'light' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('torob-match:theme', theme)
  }, [theme])
  useEffect(() => {
    const onPopState = () => {
      const nextIntent = getIntent()
      const nextAnalysis = analyzeSearchIntent(nextIntent, initialQuery)
      searchRequestRef.current += 1
      setView(getView())
      setIntent(nextIntent)
      setSearch(nextIntent)
      setIntentAnalysis(nextAnalysis)
      setQuery(nextAnalysis.query)
      setEnhancerStatus('idle')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => { document.body.classList.toggle('dialog-open', mobileFilters || compareOpen || methodOpen); return () => document.body.classList.remove('dialog-open') }, [mobileFilters, compareOpen, methodOpen])
  useLayoutEffect(() => {
    const updateFilterHeight = () => {
      const panelTop = desktopFiltersRef.current?.getBoundingClientRect().top
      if (panelTop !== undefined) desktopFiltersRef.current?.style.setProperty('--filter-available-height', `${Math.max(170, window.innerHeight - panelTop - 10)}px`)
    }
    updateFilterHeight()
    window.addEventListener('scroll', updateFilterHeight, { passive: true })
    window.addEventListener('resize', updateFilterHeight)
    return () => {
      window.removeEventListener('scroll', updateFilterHeight)
      window.removeEventListener('resize', updateFilterHeight)
    }
  }, [])

  if (view === 'home') return <HomePage theme={theme} intent={intent} onIntentChange={setIntent} onSearch={showResults} onToggleTheme={toggleTheme} />

  const resultsHeader = <header className="site-header"><div className="header-inner"><Logo onClick={goHome} /><form className="header-search" role="search" onSubmit={event => { event.preventDefault(); showResults(search) }}><button className="header-search-submit" type="submit" aria-label="اجرای جست‌وجو"><Search size={20} /></button><input aria-label="جست‌وجوی دوره" value={search} onChange={event => setSearch(event.target.value)} placeholder="مثلاً RAG پروژه‌محور با بودجه ۳ تا ۸ میلیون" /><kbd>/</kbd></form>{intentAnalysis.supported && <nav className="header-nav" aria-label="ناوبری اصلی"><button onClick={() => setMethodOpen(true)}>روش رتبه‌بندی</button><a href="#results">دوره‌ها</a><span className="saved-label"><Bookmark size={17} /> ذخیره‌شده‌ها <b>{asPersianNumber(savedIds.length)}</b></span></nav>}<ThemeToggle theme={theme} onToggle={toggleTheme} />{intentAnalysis.supported && <button className="icon-button header-menu" aria-label="باز کردن فیلترها" onClick={() => setMobileFilters(true)}><Menu size={22} /></button>}</div></header>

  if (!intentAnalysis.supported) return <div className="app-shell">{resultsHeader}<UnsupportedState intent={intent} onTrySupported={() => showResults('ساخت RAG با پایتون')} onHome={goHome} /></div>

  return <div className="app-shell">
    {resultsHeader}
    <main className="page-container"><div className="breadcrumb">خانه <span>/</span> دوره‌های هوش مصنوعی <span>/</span> نتایج جست‌وجو</div><div className="page-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> انتخاب آگاهانه، نه حدس زدن</span><h1>دوره‌های مناسب برای <em><bdi dir="rtl">{intent}</bdi></em></h1><p>۸ دورهٔ مستند را با بودجه، زمان و مهارت خودت مقایسه کن؛ همراه با دلیل رتبه و داده‌های نامطمئن.</p></div><div className="hero-stat"><span className="stat-icon"><Sparkles size={23} /></span><strong>{asPersianNumber(ranked.summary.visible_courses)}</strong><span>دوره برای بررسی</span></div></div>
      <div className="layout-grid"><div className="results-column" id="results"><section className="query-summary"><div className="summary-heading"><div><span className="summary-icon"><CheckCircle2 size={18} /></span><strong>برداشت ترب مچ از نیاز شما</strong></div><button className="text-button" onClick={() => setMobileFilters(true)}>ویرایش معیارها <ArrowLeft size={14} /></button></div><div className="summary-chips" tabIndex={0} aria-label="خلاصهٔ معیارها؛ برای پیمایش از کلیدهای جهت‌دار استفاده کنید"><span>جست‌وجو: <b>{intent}</b></span><span>مهارت: <b>Python {levelName[query.skills.python]}</b></span><span>بودجه: <b><bdi dir="rtl">{million(query.budget.preferred_max_toman)} تا {million(query.budget.flexible_max_toman)}</bdi></b></span><span>ساعت هفتگی: <b><bdi dir="rtl">{asPersianNumber(query.time.preferred_hours_per_week)} ساعت/هفته تا {asPersianNumber(query.time.flexible_hours_per_week)} ساعت/هفته</bdi></b></span><span>مهلت: <b><bdi dir="rtl">{asPersianNumber(query.time.preferred_deadline_weeks)} هفته تا {asPersianNumber(query.time.flexible_deadline_weeks)} هفته</bdi></b></span></div>{enhancerStatus !== 'idle' && <div className={`enhancer-status ${enhancerStatus}`} role="status" aria-live="polite"><Sparkles size={15} />{enhancerStatus === 'loading' ? 'در حال بررسی ابهام‌های متن…' : enhancerStatus === 'enhanced' ? 'معیارهای مبهم با کمک تحلیل هوشمند تکمیل شدند.' : 'تحلیل هوشمند در دسترس نبود؛ معیارهای قطعی استفاده شدند.'}</div>}</section>
        <div className="result-toolbar"><div><span className="toolbar-kicker">نتایج شخصی‌سازی‌شده</span><h2>{asPersianNumber(searchFiltered.length)} نتیجه برای <bdi dir="rtl">{intent}</bdi></h2><p>پیشنهادهای اول با شرایط فعلی سازگارند؛ بقیه با تغییرهای لازم همچنان دیده می‌شوند.</p></div><label className="sort-field"><span>مرتب‌سازی</span><select aria-label="مرتب‌سازی دوره‌ها" value={sort} onChange={event => setSort(event.target.value)}><option value="recommended">پیشنهادی</option><option value="price">کمترین قیمت</option><option value="duration">کوتاه‌ترین مدت</option></select><ChevronDown size={15} /></label></div>
        <div className="tabs" role="tablist" aria-label="گروه نتایج"><button role="tab" aria-selected={group === 'all'} className={group === 'all' ? 'active' : ''} onClick={() => setGroup('all')}>همه <span>{asPersianNumber(searchFiltered.length)}</span></button>{GROUP_ORDER.slice(0, 3).map(key => <button key={key} role="tab" aria-selected={group === key} className={group === key ? 'active' : ''} onClick={() => setGroup(key)}>{groupName[key]} <span>{asPersianNumber(counts[key])}</span></button>)}</div>
        <div className="result-message"><Info size={17} /><span>{evaluationImportant && unverifiedEvaluationCount > 0 ? <><strong>پوشش Evaluation برای {asPersianNumber(unverifiedEvaluationCount)} گزینهٔ مناسب شرایط فعلی اثبات نشده است.</strong> پیش از خرید، سرفصل و پروژهٔ دوره را از برگزارکننده بررسی کنید.</> : <><strong>رتبه‌ها تضمین کیفیت دوره نیستند.</strong> قیمت، ظرفیت و جزئیات نامطمئن را پیش از ثبت‌نام از منبع بررسی کنید.</>}</span><button onClick={() => setMethodOpen(true)}>چرا؟</button></div>
        <div className="cards-heading"><div><span className="eyebrow">با توجه به شرایط شما</span><h2>{group === 'all' ? 'پیشنهادهای اول' : groupName[group]}</h2></div><span>{asPersianNumber(shown.length)} گزینه</span></div>
        <div className="cards-list">{shown.length ? shown.map((row, index) => <CourseCard key={row.course_id} row={row} course={courseById.get(row.course_id)!} index={index + 1} selected={compareIds.includes(row.course_id)} saved={savedIds.includes(row.course_id)} onCompare={() => toggleCompare(row.course_id)} onSave={() => toggleSaved(row.course_id)} featured={featuredIds.has(row.course_id) && sort === 'recommended'} />) : <div className="empty-state"><Search size={27} /><h3>در این گروه دوره‌ای نیست</h3><p>همهٔ دوره‌ها را ببین یا معیارها را تغییر بده.</p><button className="outline-button" onClick={() => setGroup('all')}>نمایش همهٔ دوره‌ها</button></div>}</div>
        <p className="data-disclaimer"><Info size={16} /> اطلاعات این نسخه از صفحات عمومی برگزارکنندگان در {formatObservedDate(dataset.dataset.observed_at)} ثبت شده و قیمت یا ظرفیت زنده نیست.</p>
      </div><div className="desktop-filters" ref={desktopFiltersRef}><FilterPanel query={query} onChange={applyManualQuery} onReset={() => applyManualQuery(intentAnalysis.query)} onShow={() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })} count={ranked.summary.visible_courses} /></div></div>
    </main>
    {compareIds.length > 0 && <div className="compare-tray" role="region" aria-label="نوار مقایسه"><div className="compare-inner"><div className="tray-count"><div className="tray-icon"><SlidersHorizontal size={20} /></div><div><strong>مقایسهٔ {asPersianNumber(compareIds.length)} دوره</strong><span>تا ۳ دوره را کنار هم ببین</span></div></div><div className="tray-items">{compareIds.map(id => <button key={id} onClick={() => toggleCompare(id)} title="حذف از مقایسه">{courseById.get(id)?.title_fa}<X size={14} /></button>)}</div><button className="primary-button" disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}>مقایسه کنار هم <ArrowLeft size={17} /></button></div></div>}
    <div className="mobile-dock"><button onClick={() => setMobileFilters(true)}><Filter size={19} /> فیلترها</button><button disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}><SlidersHorizontal size={19} /> مقایسه {compareIds.length ? asPersianNumber(compareIds.length) : ''}</button></div>
    {mobileFilters && <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMobileFilters(false) }}><div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="تنظیم فیلترها"><FilterPanel query={query} onChange={applyManualQuery} onReset={() => applyManualQuery(intentAnalysis.query)} onClose={() => setMobileFilters(false)} count={ranked.summary.visible_courses} /></div></div>}
    {compareOpen && <CompareDialog ids={compareIds} rows={allRows} onClose={() => setCompareOpen(false)} onRemove={toggleCompare} />}
    {methodOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMethodOpen(false) }}><div className="method-modal" role="dialog" aria-modal="true" aria-labelledby="method-title"><div className="modal-heading"><div><span className="eyebrow">شفافیت انتخاب</span><h2 id="method-title">دوره‌ها چطور رتبه می‌گیرند؟</h2></div><button className="icon-button" aria-label="بستن توضیح رتبه‌بندی" onClick={() => setMethodOpen(false)}><X size={21} /></button></div><p>امتیاز از تناسب موضوع، پروژه و Evaluation، مهارت، زمان، بودجه، پشتیبانی و کیفیت داده ساخته می‌شود. سپس وضعیت هر دوره نسبت به معیارهای مطلوب و منعطف شما تعیین می‌شود.</p><div className="weight-list">{[['تناسب موضوع',35],['پروژه و Evaluation',20],['مهارت',15],['زمان',10],['بودجه',10],['پشتیبانی',5],['اطمینان داده',5]].map(([label, weight]) => <div key={label}><span>{label}</span><strong>{asPersianNumber(Number(weight))}٪</strong><i style={{ width: `${weight}%` }} /></div>)}</div><div className="method-note"><CircleAlert size={19} /> مجهول بودن یک ویژگی به معنای نبود آن نیست. دوره حذف نمی‌شود؛ کنار همان ویژگی هشدار می‌بینید.</div></div></div>}
  </div>
}
