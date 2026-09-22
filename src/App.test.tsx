import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('results experience', () => {
  it('renders every documented course and the source-data warning', () => {
    render(<App />)
    expect(screen.getAllByTestId(/^course-/)).toHaveLength(8)
    expect(screen.getAllByText(/پوشش Evaluation برای/).length).toBeGreaterThan(0)
    expect(screen.getByText(/قیمت یا ظرفیت زنده نیست/)).toBeInTheDocument()
  })

  it('reranks when the budget changes without removing courses', () => {
    render(<App />)
    const panel = screen.getByRole('complementary', { name: 'فیلتر و انعطاف' })
    fireEvent.change(within(panel).getByRole('slider', { name: 'مرز انعطاف بودجه' }), { target: { value: '20000000' } })
    expect(within(panel).getByText('۲۰ میلیون')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^course-/)).toHaveLength(8)
    fireEvent.click(within(panel).getByRole('button', { name: 'بازنشانی' }))
    expect(within(panel).getByRole('slider', { name: 'مرز انعطاف بودجه' })).toHaveValue('10000000')
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
