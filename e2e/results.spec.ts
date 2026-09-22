import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('eight documented courses, transparent ranking, and no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('RAG')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
  await expect(page.locator('[data-testid="course-jahani-langchain-fa"]')).toBeVisible()
  await expect(page.getByText(/پوشش Evaluation برای .* گزینهٔ مناسب شرایط فعلی/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('filters change ranking without discarding courses, and reset restores baseline', async ({ page, isMobile }) => {
  await page.goto('/')
  if (isMobile) await page.getByRole('button', { name: 'فیلترها', exact: true }).click()
  const panel = isMobile ? page.getByRole('dialog', { name: 'تنظیم فیلترها' }) : page.getByRole('complementary', { name: 'فیلتر و انعطاف' })
  await panel.getByRole('slider', { name: 'مرز انعطاف بودجه' }).fill('20000000')
  await expect(panel.getByText('۲۰ میلیون')).toBeVisible()
  await panel.getByRole('combobox', { name: 'سطح RAG' }).selectOption('beginner')
  if (isMobile) await panel.getByRole('button', { name: /نمایش .* دوره/ }).click()
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
  if (isMobile) await page.getByRole('button', { name: 'فیلترها', exact: true }).click()
  await panel.getByRole('button', { name: 'بازنشانی' }).click()
  await expect(panel.getByRole('slider', { name: 'مرز انعطاف بودجه' })).toHaveValue('10000000')
})

test('compare two courses side by side', async ({ page }) => {
  await page.goto('/')
  const cards = page.locator('[data-testid^="course-"]')
  await cards.nth(0).getByRole('button', { name: 'افزودن به مقایسه' }).click()
  await cards.nth(1).getByRole('button', { name: 'افزودن به مقایسه' }).click()
  await page.getByRole('button', { name: /مقایسه کنار هم|مقایسه ۲/ }).last().click()
  await expect(page.getByRole('dialog', { name: 'مقایسهٔ کنارهمی دوره‌ها' })).toBeVisible()
  await expect(page.getByRole('columnheader')).toHaveCount(3)
})

test('search is scoped to the eight-course dataset', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'جست‌وجو در دوره‌های موجود' }).fill('ناموجود')
  await expect(page.getByText('دوره‌ای با این جست‌وجو پیدا نشد')).toBeVisible()
  await page.getByRole('button', { name: 'پاک‌کردن جست‌وجو' }).click()
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
})

test('page has no serious or critical automated accessibility violations', async ({ page }) => {
  await page.goto('/')
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const serious = report.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')
  const concise = serious.map(item => ({
    id: item.id,
    nodes: item.nodes.map(node => ({ target: node.target.join(' '), color: node.any[0]?.data })),
  }))
  expect(concise).toEqual([])
})

test('visual reference screenshot', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.screenshot({ path: testInfo.outputPath('results-full.png'), fullPage: true })
})
