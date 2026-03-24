import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Search, Variable, Settings, History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useCollectionStore } from '@/stores/collection-store'
import CollectionTree from '@/components/tree/collection-tree'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { collections, trees, selectedNodeId, loadCollections, createCollection, selectNode } = useCollectionStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadCollections()
  }, [])

  const handleCreateCollection = () => {
    const existingNumbers = collections
      .map((c) => {
        const match = c.name.match(/^新集合\s*(\d+)?$/)
        return match ? parseInt(match[1] || '0', 10) : -1
      })
      .filter((n) => n >= 0)
    const next = existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1
    createCollection(`新集合 ${next}`, '')
  }

  const navItems = [
    { icon: History, label: '历史记录', onClick: () => navigate('/history'), active: location.pathname === '/history' },
    { icon: Variable, label: '环境变量', onClick: () => navigate('/environments'), active: location.pathname === '/environments' },
    { icon: Settings, label: '设置', onClick: () => navigate('/settings'), active: location.pathname === '/settings' },
  ]

  return (
    <div className="flex flex-col h-full bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <span className="text-xs font-bold text-primary-foreground">Q</span>
        </div>
        <span className="text-sm font-semibold text-sidebar-foreground tracking-tight">QAI</span>
      </div>

      {/* + 按钮和搜索框同行 */}
      <div className="flex items-center gap-1.5 px-3 pb-3">
        <div className="relative group/add shrink-0">
          <button
            className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
            onClick={handleCreateCollection}
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 px-2 py-1 rounded-md bg-foreground text-background text-[11px] whitespace-nowrap opacity-0 group-hover/add:opacity-100 transition-opacity pointer-events-none z-50">
            新建集合
          </span>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="pl-8 h-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        {collections.length > 0 ? (
          <CollectionTree
            collections={collections}
            trees={trees}
            selectedNodeId={selectedNodeId}
            onSelect={(nodeId) => {
              navigate('/')
              selectNode(nodeId)
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4">
            <p className="text-sm text-muted-foreground">暂无集合</p>
            <p className="text-xs text-muted-foreground/60 mt-1">点击 + 创建</p>
          </div>
        )}
      </div>

      <nav className="border-t border-sidebar-border px-3 py-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer
              ${item.active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground'
              }`}
            onClick={item.onClick}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
