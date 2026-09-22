import type { Level } from './ranking'

const levelName: Record<Level, string> = {
  none: 'بدون تجربه',
  beginner: 'مقدماتی',
  intermediate: 'متوسط',
  advanced: 'پیشرفته',
}

const persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
})

export function formatObservedDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'نامشخص'
  const date = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) return 'نامشخص'
  return persianDate.format(date)
}

export function formatAdjustment(text: string): string {
  return text.replace(/\b(none|beginner|intermediate|advanced)\b/g, level => levelName[level as Level])
}
