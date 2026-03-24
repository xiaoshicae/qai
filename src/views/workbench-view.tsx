import { useEffect } from 'react'
import { Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollectionStore } from '@/stores/collection-store'
import { useRequestStore } from '@/stores/request-store'
import { useTabsStore } from '@/stores/tabs-store'
import RequestPanel from '@/components/request/request-panel'
import ResponsePanel from '@/components/response/response-panel'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

export default function WorkbenchView() {
  const selectedRequestId = useCollectionStore((s) => s.selectedRequestId)
  const { currentRequest, loadRequest } = useRequestStore()
  const { tabs, activeTabId, openTab, closeTab, setActiveTab } = useTabsStore()

  // 侧边栏点击请求 → 打开标签
  useEffect(() => {
    if (selectedRequestId) {
      // 需要先加载请求信息拿到 name/method
      loadRequest(selectedRequestId)
    }
  }, [selectedRequestId])

  // 请求加载完成后打开标签
  useEffect(() => {
    if (currentRequest && selectedRequestId === currentRequest.id) {
      openTab(currentRequest.id, currentRequest.name, currentRequest.method)
    }
  }, [currentRequest?.id])

  // 切换标签时加载对应请求
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab && activeTab.requestId !== currentRequest?.id) {
      loadRequest(activeTab.requestId)
    }
  }, [activeTabId])

  // 更新标签名称（当请求名变化时）
  useEffect(() => {
    if (currentRequest) {
      useTabsStore.getState().updateTab(currentRequest.id, {
        name: currentRequest.name,
        method: currentRequest.method,
      })
    }
  }, [currentRequest?.name, currentRequest?.method])

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-4">
          <Send className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1">选择一个请求开始测试</h3>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          在左侧选择已有请求，或创建新的集合
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标签栏 */}
      <div className="flex items-center h-9 border-b border-border bg-background shrink-0 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const color = METHOD_COLORS[tab.method?.toUpperCase()] ?? 'text-muted-foreground'
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-1.5 h-full px-3 border-r border-border cursor-pointer text-[12px] transition-colors shrink-0 max-w-[180px]',
                active
                  ? 'bg-muted/50 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={cn('text-[10px] font-bold font-mono shrink-0', color)}>
                {tab.method?.substring(0, 3).toUpperCase()}
              </span>
              <span className="truncate">{tab.name || '未命名'}</span>
              <button
                className="ml-auto shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* 请求/响应面板 */}
      {currentRequest ? (
        <>
          <div className="shrink-0 overflow-y-auto p-5 pb-3 max-h-[50%]">
            <RequestPanel />
          </div>
          <div className="h-px bg-border mx-5 shrink-0" />
          <div className="flex-1 overflow-y-auto p-5 pt-4 min-h-0">
            <ResponsePanel />
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          加载中...
        </div>
      )}
    </div>
  )
}
