import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const resultsUrl = '/search?q=%D8%B3%D8%A7%D8%AE%D8%AA%20RAG%20%D8%A8%D8%A7%20%D9%BE%D8%A7%DB%8C%D8%AA%D9%88%D9%86'

test('home search leads to the approved results experience', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('دوره‌ای را پیدا کن')
  await expect(page.getByRole('button', { name: /ترب مچ؛ بازگشت/ }).first()).toBeVisible()
  await page.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' }).fill('ساخت RAG با پایتون')
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click()
  await expect(page).toHaveURL(/\/search\?q=/)
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
})

test('theme can be changed and persists between pages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'فعال‌کردن حالت تیره' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'فعال‌کردن حالت روشن' })).toBeVisible()
})

test('eight documented courses, transparent ranking, and no horizontal overflow', async ({ page }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('RAG')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
  await expect(page.locator('[data-testid="course-jahani-langchain-fa"]')).toBeVisible()
  await expect(page.getByText(/پوشش Evaluation برای .* گزینهٔ مناسب شرایط فعلی/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('filters change ranking without discarding courses, and reset restores baseline', async ({ page, isMobile }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  if (isMobile) await page.getByRole('button', { name: 'فیلترها', exact: true }).click()
  const panel = isMobile ? page.getByRole('dialog', { name: 'تنظیم فیلترها' }) : page.getByRole('complementary', { name: 'فیلتر و انعطاف' })
  await panel.getByRole('slider', { name: 'حداکثر بودجه' }).fill('20000000')
  await expect(panel.getByText('۲۰ میلیون')).toBeVisible()
  await panel.getByRole('slider', { name: 'حداکثر ساعت در هفته' }).fill('16')
  await panel.getByRole('slider', { name: 'حداکثر مهلت مطلوب' }).fill('32')
  await panel.getByRole('combobox', { name: 'سطح RAG' }).selectOption('beginner')
  if (isMobile) await panel.getByRole('button', { name: /نمایش .* دوره/ }).click()
  await expect(page.getByText('۶ ساعت/هفته تا ۱۶ ساعت/هفته')).toBeVisible()
  await expect(page.getByText('۱۲ هفته تا ۳۲ هفته')).toBeVisible()
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
  if (isMobile) await page.getByRole('button', { name: 'فیلترها', exact: true }).click()
  await panel.getByRole('button', { name: 'بازنشانی' }).click()
  await expect(panel.getByRole('slider', { name: 'حداکثر بودجه' })).toHaveValue('10000000')
  await expect(panel.getByRole('slider', { name: 'حداکثر ساعت در هفته' })).toHaveValue('10')
  await expect(panel.getByRole('slider', { name: 'حداکثر مهلت مطلوب' })).toHaveValue('20')
})

test('two handles share each range track, with Persian dates and skill levels', async ({ page, isMobile }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  if (isMobile) await page.getByRole('button', { name: 'فیلترها', exact: true }).click()
  const panel = isMobile ? page.getByRole('dialog', { name: 'تنظیم فیلترها' }) : page.getByRole('complementary', { name: 'فیلتر و انعطاف' })
  for (const [minimum, maximum] of [
    ['حداقل بودجه', 'حداکثر بودجه'],
    ['حداقل ساعت در هفته', 'حداکثر ساعت در هفته'],
    ['حداقل مهلت مطلوب', 'حداکثر مهلت مطلوب'],
  ]) {
    const first = await panel.getByRole('slider', { name: minimum }).boundingBox()
    const second = await panel.getByRole('slider', { name: maximum }).boundingBox()
    expect(Math.abs((first?.y ?? 0) - (second?.y ?? 0))).toBeLessThanOrEqual(3)
  }
  if (isMobile) await panel.getByRole('button', { name: /نمایش .* دوره/ }).click()
  await expect(page.locator('[data-testid="course-udemyiran-langgraph"]')).toContainText('بدون تجربه')
  await expect(page.locator('[data-testid="course-udemyiran-langgraph"]')).toContainText('مقدماتی')
  await expect(page.locator('[data-testid="course-jahani-langchain-fa"]')).toContainText('۱۴۰۵/۰۶/۲۷')
  await expect(page.locator('.data-disclaimer')).toContainText('۱۴۰۵/۰۶/۲۷')
})

test('desktop filter bottom is reachable without scrolling the results page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop sidebar only')
  await page.setViewportSize({ width: 1440, height: 650 })
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  const panel = page.getByRole('complementary', { name: 'فیلتر و انعطاف' })
  const content = panel.locator('.filter-content')
  await expect(panel.getByRole('button', { name: /نمایش .* دوره/ })).toBeInViewport()
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(panel.getByRole('checkbox', { name: 'پشتیبانی مدرس' })).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('desktop budget range handles can be dragged independently', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse dragging is checked on desktop')
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  const panel = page.getByRole('complementary', { name: 'فیلتر و انعطاف' })
  const upper = panel.getByRole('slider', { name: 'حداکثر بودجه' })
  const bounds = await upper.boundingBox()
  expect(bounds).not.toBeNull()
  const y = bounds!.y + bounds!.height / 2
  const start = bounds!.x + bounds!.width * (10 / 30)
  const end = bounds!.x + bounds!.width * (15 / 30)
  await page.mouse.move(start, y)
  await page.mouse.down()
  await page.mouse.move(end, y, { steps: 8 })
  await page.mouse.up()
  expect(Number(await upper.inputValue())).toBeGreaterThanOrEqual(14_000_000)
  await expect(panel.getByRole('slider', { name: 'حداقل بودجه' })).toHaveValue('5000000')
})

test('compare two courses side by side', async ({ page }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  const cards = page.locator('[data-testid^="course-"]')
  await cards.nth(0).getByRole('button', { name: 'افزودن به مقایسه' }).click()
  await cards.nth(1).getByRole('button', { name: 'افزودن به مقایسه' }).click()
  await page.getByRole('button', { name: /مقایسه کنار هم|مقایسه ۲/ }).last().click()
  await expect(page.getByRole('dialog', { name: 'مقایسهٔ کنارهمی دوره‌ها' })).toBeVisible()
  await expect(page.getByRole('columnheader')).toHaveCount(3)
})

test('search is honest outside the dataset and can return to a supported query', async ({ page }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'جست‌وجوی دوره' }).fill('دوره TypeScript برای فرانت‌اند')
  await page.getByRole('textbox', { name: 'جست‌وجوی دوره' }).press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('دادهٔ کافی نداریم')
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(0)
  await page.getByRole('button', { name: /جست‌وجوی RAG با پایتون/ }).click()
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(8)
})

test('a natural-language search updates constraints and intent-aware ranking', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const phrase = 'آموزش LangChain فارسی پروژه‌محور با بودجه ۳ تا ۸ میلیون و ۸ ساعت در هفته'
  await page.getByRole('textbox', { name: 'چه چیزی می‌خواهی یاد بگیری؟' }).fill(phrase)
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(phrase)
  await expect(page.getByText('۳ میلیون تا ۸ میلیون')).toBeVisible()
  await expect(page.getByText('۸ ساعت/هفته تا ۱۰ ساعت/هفته')).toBeVisible()
  await expect(page.locator('[data-testid^="course-"]').first()).toHaveAttribute('data-testid', 'course-jahani-langchain-fa')
})

test('page has no serious or critical automated accessibility violations', async ({ page }) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const serious = report.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')
  const concise = serious.map(item => ({
    id: item.id,
    nodes: item.nodes.map(node => ({ target: node.target.join(' '), color: node.any[0]?.data })),
  }))
  expect(concise).toEqual([])
})

test('visual reference screenshot', async ({ page }, testInfo) => {
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: testInfo.outputPath('results-viewport.png') })
  await page.screenshot({ path: testInfo.outputPath('results-full.png'), fullPage: true })
})

test('home and dark results visual references', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.brand-lockup').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
  await page.screenshot({ path: testInfo.outputPath('home-light.png'), fullPage: true })
  await page.getByRole('button', { name: 'فعال‌کردن حالت تیره' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('home-dark.png'), fullPage: true })
  await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: testInfo.outputPath('results-dark.png') })
})
