import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './button'
import i18n from '@/i18n'

const t = (key: string) => i18n.t(key)

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex h-full min-h-[200px] items-center justify-center p-8">
          <div className="flex flex-col items-center text-center max-w-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="text-sm font-semibold text-foreground mb-2">
              {t('error.title')}
            </h2>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {t('error.description')}
            </p>
            {this.state.error && (
              <pre className="text-[10px] text-muted-foreground/60 bg-overlay/[0.04] rounded-lg p-3 mb-4 max-w-full overflow-x-auto">
                {this.state.error.message}
              </pre>
            )}
            <Button size="sm" onClick={this.handleRetry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {t('error.retry')}
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/** 全局错误页面 - 用于路由级错误 */
export function GlobalErrorPage({ error, onRetry }: { error?: Error; onRetry?: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center p-8 bg-background">
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 mb-5">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">
          {t('error.page_title')}
        </h1>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          {t('error.page_description')}
        </p>
        {error && (
          <pre className="text-xs text-muted-foreground/60 bg-overlay/[0.04] rounded-xl p-4 mb-5 max-w-full overflow-x-auto">
            {error.message}
          </pre>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            {t('error.refresh')}
          </Button>
          {onRetry && (
            <Button size="sm" onClick={onRetry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {t('error.retry')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
