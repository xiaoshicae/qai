import { useCollectionStore } from '@/stores/collection-store'
import CollectionOverview from '@/components/collection/collection-overview'
import { Zap } from 'lucide-react'

export default function WorkbenchView() {
  const { selectedNodeId, collections, trees } = useCollectionStore()

  const selectedCollection = collections.find((c) => c.id === selectedNodeId)

  if (selectedCollection) {
    return (
      <div className="h-full overflow-y-auto">
        <CollectionOverview
          collection={selectedCollection}
          tree={trees[selectedCollection.id]}
        />
      </div>
    )
  }

  // 空状态 — 未选中任何 model
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mx-auto mb-4">
          <Zap className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-medium text-muted-foreground">选择一个集合开始测试</h2>
        <p className="text-xs text-muted-foreground/60 mt-1">从左侧选择集合，或导入 YAML 测试用例</p>
      </div>
    </div>
  )
}
