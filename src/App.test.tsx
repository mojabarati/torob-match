import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
  window.history.replaceState({}, '', '/')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('home and brand experience', () => {
  it('starts from the Torob Match search homepage and opens results', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /دوره‌ای را پیدا کن/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText(/ترب مچ/).length).toBeGreaterThan(0)
    expect(screen.queryByText('۸ دورهٔ مستند')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' })
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'ساخت RAG با پایتون')
    fireEvent.change(input, { target: { value: 'ساخت RAG با پایتون' } })
    fireEvent.click(screen.getByRole('button', { name: /جست‌وجو/ }))
    expect(screen.getByRole('status')).toHaveTextContent('داریم بهترین نتیجه‌ها را مرتب می‌کنیم')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('۸ نتیجه برای ساخت RAG با پایتون')
    expect(screen.queryByText(/دوره‌های مناسب برای/)).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/search')
  })

  it('switches between light and dark modes', () => {
    const { container } = render(<App />)
    const logo = container.querySelector('.brand-lockup') as HTMLImageElement
    expect(logo.getAttribute('src')).toBe('/brand/torob-match-logo.png')
    fireEvent.click(screen.getByRole('button', { name: 'فعال‌کردن حالت تیره' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('torob-match:theme')).toBe('dark')
    expect(container.querySelectorAll('.brand-lockup')).toHaveLength(1)
    expect(logo.getAttribute('src')).toBe('/brand/torob-match-logo.png')
  })

  it('shows an honest no-data state for topics outside the documented dataset', async () => {
    const { container } = render(<App />)
    const input = screen.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' })
    fireEvent.change(input, { target: { value: 'دوره TypeScript برای فرانت‌اند' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByRole('status')).toHaveTextContent('داریم بهترین نتیجه‌ها را مرتب می‌کنیم')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('دادهٔ کافی نداریم')
    expect(screen.getByText(/مجموعهٔ مستند این نسخه روی RAG/)).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^course-/)).toHaveLength(0)
    const headerActions = container.querySelector('.header-actions')!
    expect(within(headerActions as HTMLElement).getByRole('button', { name: 'فعال‌کردن حالت تیره' })).toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /جست‌وجوی RAG با پایتون/ }))
    expect(await screen.findAllByTestId(/^course-/)).toHaveLength(8)
  })

  it('uses the optional enhancer only for an ambiguous search and shows its status', async () => {
    vi.stubEnv('VITE_INTENT_ENHANCER_ENABLED', 'true')
    let finishRequest = () => {}
    const fetchMock = vi.fn(() => new Promise(resolve => {
      finishRequest = () => resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          fields: {
            'budget.preferred_max_toman': { value: 7_000_000, confidence: .8, evidence: 'هفت تا دوازده میلیون' },
            'budget.flexible_max_toman': { value: 12_000_000, confidence: .8, evidence: 'هفت تا دوازده میلیون' },
          },
        })),
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' })
    fireEvent.change(input, { target: { value: 'RAG می‌خواهم ولی بودجه‌ام مشخص نیست' } })
    fireEvent.submit(input.closest('form')!)

    expect(screen.getByRole('status')).toHaveTextContent('داریم نیازت را دقیق می‌خوانیم')
    finishRequest()
    expect(await screen.findByText('۷ میلیون تا ۱۲ میلیون')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('معیارهای مبهم با کمک تحلیل هوشمند تکمیل شدند.')
    const source = screen.getAllByText('تکمیل هوشمند')[0]
    fireEvent.click(source)
    expect(screen.getByText(/شاهد: هفت تا دوازده میلیون/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('results experience', () => {
  beforeEach(() => window.history.replaceState({}, '', '/search?q=ساخت%20RAG%20با%20پایتون'))

  it('renders every documented course and the source-data warning', () => {
    render(<App />)
    expect(screen.getAllByTestId(/^course-/)).toHaveLength(8)
    const firstCard = screen.getAllByTestId(/^course-/)[0]
    expect(within(firstCard).getByLabelText('رتبهٔ ۱')).toHaveTextContent('۱')
    expect(within(firstCard).queryByText('گزینهٔ ۱')).not.toBeInTheDocument()
    expect(screen.getAllByText(/پوشش Evaluation برای/).length).toBeGreaterThan(0)
    expect(screen.getByText(/قیمت یا ظرفیت زنده نیست/)).toBeInTheDocument()
    expect(screen.getByText('۶ ساعت/هفته تا ۱۰ ساعت/هفته')).toBeInTheDocument()
    expect(screen.getByText('۱۲ هفته تا ۲۰ هفته')).toBeInTheDocument()
  })

  it('reranks when the budget changes without removing courses', () => {
    render(<App />)
    const panel = screen.getByRole('complementary', { name: 'فیلتر و انعطاف' })
    fireEvent.change(within(panel).getByRole('slider', { name: 'حداکثر بودجه' }), { target: { value: '20000000' } })
    expect(within(panel).getByText('۲۰ میلیون')).toBeInTheDocument()
    expect(screen.getByText('۵ میلیون تا ۲۰ میلیون')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^course-/)).toHaveLength(8)
    fireEvent.click(within(panel).getByRole('button', { name: 'بازنشانی' }))
    expect(within(panel).getByRole('slider', { name: 'حداکثر بودجه' })).toHaveValue('10000000')
  })

  it('keeps each range ordered and localizes skill adjustments and dates', () => {
    render(<App />)
    const panel = screen.getByRole('complementary', { name: 'فیلتر و انعطاف' })
    const minimumHours = within(panel).getByRole('slider', { name: 'حداقل ساعت در هفته' })
    const maximumHours = within(panel).getByRole('slider', { name: 'حداکثر ساعت در هفته' })
    fireEvent.change(maximumHours, { target: { value: '12' } })
    fireEvent.change(minimumHours, { target: { value: '30' } })
    expect(minimumHours).toHaveValue('12')
    expect(maximumHours).toHaveValue('12')
    expect(screen.getByTestId('course-udemyiran-langgraph')).toHaveTextContent('بدون تجربه')
    expect(screen.getByTestId('course-udemyiran-langgraph')).toHaveTextContent('مقدماتی')
    expect(screen.getByTestId('course-jahani-langchain-fa')).toHaveTextContent('۱۴۰۵/۰۶/۲۷')
  })

  it('opens a comparison after selecting two courses', () => {
    render(<App />)
    const cards = screen.getAllByTestId(/^course-/)
    fireEvent.click(within(cards[0]).getByRole('button', { name: /افزودن به مقایسه/ }))
    fireEvent.click(within(cards[1]).getByRole('button', { name: /افزودن به مقایسه/ }))
    fireEvent.click(screen.getByRole('button', { name: /مقایسه کنار هم/ }))
    const dialog = screen.getByRole('dialog', { name: 'مقایسهٔ کنارهمی دوره‌ها' })
    expect(dialog).toBeInTheDocument()
    const score = dialog.querySelector('.table-score bdi')
    expect(score).toHaveAttribute('dir', 'ltr')
    expect(score).toHaveTextContent(/^[۰-۹٫]+ \/ ۱۰۰$/)
  })

  it('clears the complete result session when returning home', async () => {
    render(<App />)
    const cards = screen.getAllByTestId(/^course-/)
    fireEvent.click(within(cards[0]).getByRole('button', { name: /افزودن به مقایسه/ }))
    fireEvent.click(within(cards[0]).getByRole('button', { name: /^ذخیره / }))
    const panel = screen.getByRole('complementary', { name: 'فیلتر و انعطاف' })
    fireEvent.change(within(panel).getByRole('slider', { name: 'حداکثر بودجه' }), { target: { value: '20000000' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'مرتب‌سازی دوره‌ها' }), { target: { value: 'price' } })
    fireEvent.click(screen.getByRole('tab', { name: /با کمی انعطاف/ }))

    fireEvent.click(screen.getByRole('button', { name: /ترب مچ؛ بازگشت به صفحهٔ اصلی/ }))

    const homeInput = screen.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' })
    expect(homeInput).toHaveValue('')
    expect(homeInput).toHaveAttribute('placeholder', 'ساخت RAG با پایتون')
    expect(screen.queryByRole('region', { name: 'نوار مقایسه' })).not.toBeInTheDocument()
    expect(localStorage.getItem('torob-match:saved')).toBe('[]')

    fireEvent.click(screen.getByRole('button', { name: 'ساخت RAG با پایتون' }))
    expect(await screen.findAllByTestId(/^course-/)).toHaveLength(8)
    const freshPanel = screen.getByRole('complementary', { name: 'فیلتر و انعطاف' })
    expect(within(freshPanel).getByRole('slider', { name: 'حداکثر بودجه' })).toHaveValue('10000000')
    expect(screen.getByRole('combobox', { name: 'مرتب‌سازی دوره‌ها' })).toHaveValue('recommended')
    expect(screen.getByRole('tab', { name: /همه/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: 'نوار مقایسه' })).not.toBeInTheDocument()
  })

  it('runs a new search from the results header and extracts its constraints', async () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'جست‌وجوی دوره' })
    fireEvent.change(input, { target: { value: 'آموزش LangChain فارسی پروژه‌محور با بودجه ۳ تا ۸ میلیون و ۸ ساعت در هفته' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByRole('status')).toHaveTextContent('داریم بهترین نتیجه‌ها را مرتب می‌کنیم')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('آموزش LangChain فارسی پروژه‌محور')
    expect(screen.getByText('۳ میلیون تا ۸ میلیون')).toBeInTheDocument()
    expect(screen.getByText('۸ ساعت/هفته تا ۱۰ ساعت/هفته')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^course-/)[0]).toHaveAttribute('data-testid', 'course-jahani-langchain-fa')
    expect(decodeURIComponent(window.location.search)).toContain('LangChain')
  })
})
