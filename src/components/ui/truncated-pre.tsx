import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatSize } from '@/lib/formatters'

const DEFAULT_LIMIT = 5000

export function TruncatedPre({ content, limit = DEFAULT_LIMIT, className = '' }: {
  content: string
  limit?: number
  className?: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = content.length > limit

  return (
    <div>
      <pre className={`font-mono text-xs leading-relaxed whitespace-pre-wrap break-all ${className}`}>
        {needsTruncation && !expanded ? content.slice(0, limit) + '\n…' : content}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:text-primary/80 cursor-pointer mt-1 transition-colors"
        >
          {expanded ? t('common.show_less') : t('common.show_more', { size: formatSize(content.length) })}
        </button>
      )}
    </div>
  )
}
