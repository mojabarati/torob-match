import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
  window.history.replaceState({}, '', '/')
})

describe('home and brand experience', () => {
  it('starts from the Torob Match search homepage and opens results', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /دوره‌ای را پیدا کن/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText(/ترب مچ/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' }), { target: { value: 'ساخت RAG با پایتون' } })
    fireEvent.click(screen.getByRole('button', { name: /جست‌وجو/ }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('RAG')
    expect(window.location.pathname).toBe('/search')
  })

  it('switches between light and dark modes', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'فعال‌کردن حالت تیره' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('torob-match:theme')).toBe('dark')
  })
})

describe('results experience', () => {
  beforeEach(() => window.history.replaceState({}, '', '/search?q=ساخت%20RAG%20با%20پایتون'))

  it('renders every documented course and the source-data warning', () => {
    render(<App />)
    expect(screen.getAllByTestId(/^course-/)).toHaveLength(8)
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
    expect(screen.getByRole('dialog', { name: 'مقایسهٔ کنارهمی دوره‌ها' })).toBeInTheDocument()
  })
})
