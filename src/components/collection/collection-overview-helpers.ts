import type { TFunction } from 'i18next'

export function formatRelativeTime(dateStr: string, t: TFunction): string {
  const date = new Date(dateStr.replace(' ', 'T'))
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0 || Number.isNaN(diffMs)) return '-'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return t('scenario.just_now')
  if (mins < 60) return t('scenario.minutes_ago', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('scenario.hours_ago', { n: hours })
  const days = Math.floor(hours / 24)
  return t('scenario.days_ago', { n: days })
}
