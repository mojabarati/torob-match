import { expect, test } from '@playwright/test'

const ambiguousSearch = 'برای RAG دوره می‌خواهم و بودجه‌ام دو و نیم میلیون تومان است'

const submitHomeSearch = async (page: import('@playwright/test').Page, value: string) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' }).fill(value)
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click()
  await expect(page).toHaveURL(/\/search\?q=/)
}

test('shows an accessible loading state and the source of an AI-completed criterion', async ({ page }) => {
  await page.route('**/api/intent/enhance', async route => {
    await new Promise(resolve => setTimeout(resolve, 350))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fields: {
        'budget.preferred_max_toman': { value: 2_500_000, confidence: .99, evidence: 'دو و نیم میلیون تومان' },
        'budget.flexible_max_toman': { value: 2_500_000, confidence: .99, evidence: 'دو و نیم میلیون تومان' },
      } }),
    })
  })

  await submitHomeSearch(page, ambiguousSearch)
  await expect(page.getByRole('status')).toContainText('داریم نیازت را دقیق می‌خوانیم')
  await expect(page.getByRole('status')).toContainText('معیارهای مبهم با کمک تحلیل هوشمند تکمیل شدند')
  await expect(page.getByText('۲٫۵ میلیون تا ۲٫۵ میلیون')).toBeVisible()
  const source = page.locator('.criteria-source.source-llm').first()
  await expect(source.getByText('تکمیل هوشمند')).toBeVisible()
  await source.getByText('تکمیل هوشمند').click()
  await expect(source).toContainText('دو و نیم میلیون تومان')
})

test('falls back to deterministic results after provider timeout', async ({ page }) => {
  await page.route('**/api/intent/enhance', async route => {
    await new Promise(resolve => setTimeout(resolve, 3_000))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"fields":{}}' }).catch(() => {})
  })

  await submitHomeSearch(page, 'RAG می‌خواهم ولی بودجه‌ام مشخص نیست')
  await expect(page.getByRole('status')).toContainText('داریم نیازت را دقیق می‌خوانیم')
  await expect(page.getByRole('status')).toContainText('تحلیل هوشمند در دسترس نبود؛ معیارهای قطعی استفاده شدند')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
})

test('falls back when the provider returns invalid JSON', async ({ page }) => {
  await page.route('**/api/intent/enhance', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }))
  await submitHomeSearch(page, 'RAG می‌خواهم ولی بودجه‌ام مشخص نیست')
  await expect(page.getByRole('status')).toContainText('تحلیل هوشمند در دسترس نبود؛ معیارهای قطعی استفاده شدند')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
})

test('does not call the provider for a fully deterministic search', async ({ page }) => {
  let providerCalls = 0
  await page.route('**/api/intent/enhance', route => {
    providerCalls += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"fields":{}}' })
  })
  await submitHomeSearch(page, 'RAG با بودجه ۳ تا ۸ میلیون و هفته‌ای ۶ ساعت')
  await expect(page.getByRole('status')).toContainText('داریم بهترین نتیجه‌ها را مرتب می‌کنیم')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
  await page.waitForTimeout(250)
  expect(providerCalls).toBe(0)
})
