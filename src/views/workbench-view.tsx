import { useEffect } from 'react'
import { Zap, Plus } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useCollectionStore } from '@/stores/collection-store'
import { useRunQueueStore } from '@/stores/run-queue-store'
import CollectionOverview from '@/components/collection/collection-overview'
import { useTranslation } from 'react-i18next'

export default function WorkbenchView() {
  const { t } = useTranslation()
  const { selectedNodeId, collections, trees, loadTree, contextCollectionId, selectNode, createGroup } = useCollectionStore()

  const overviewCollection =
    collections.find((c) => c.id === selectedNodeId)
    ?? (contextCollectionId ? collections.find((c) => c.id === contextCollectionId) : undefined)

  useEffect(() => {
    if (overviewCollection && !trees[overviewCollection.id]) {
      void loadTree(overviewCollection.id)
    }
  }, [overviewCollection?.id, trees, loadTree])

  useEffect(() => {
    if (contextCollectionId && !trees[contextCollectionId]) {
      void loadTree(contextCollectionId)
    }
  }, [contextCollectionId, trees, loadTree])

  // 队列编排：当前集合运行完毕后，自动切换到队列中下一个集合
  const nextInQueue = useRunQueueStore((s) =>
    s.currentRunningId === null ? s.pendingQueue[0] : null
  )
  useEffect(() => {
    if (nextInQueue && nextInQueue !== overviewCollection?.id) {
      selectNode(nextInQueue)
      void loadTree(nextInQueue)
    }
  }, [nextInQueue, selectNode, loadTree, overviewCollection?.id])

  const handleCreateFirstSuite = async () => {
    await createGroup(t('app.quick_start'))
  }

  return (
    <div className="relative h-full min-h-0 w-full bg-background">
      <div className="h-full min-h-0 w-full overflow-y-auto">
        {overviewCollection ? (
          <CollectionOverview
            collection={overviewCollection}
            tree={trees[overviewCollection.id]}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={Zap}
              title={t('app.select_collection')}
              description={t('app.select_collection_hint')}
              action={
                collections.length === 0 && (
                  <Button size="sm" onClick={handleCreateFirstSuite} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    {t('app.create_first_suite')}
                  </Button>
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
