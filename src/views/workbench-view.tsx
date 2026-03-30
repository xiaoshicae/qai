import { useEffect } from 'react'
import { Zap } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useCollectionStore } from '@/stores/collection-store'
import CollectionOverview from '@/components/collection/collection-overview'
import { useTranslation } from 'react-i18next'

export default function WorkbenchView() {
  const { t } = useTranslation()
  const { selectedNodeId, collections, trees, loadTree, contextCollectionId } = useCollectionStore()

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
            <EmptyState icon={Zap} title={t('app.select_collection')} description={t('app.select_collection_hint')} />
          </div>
        )}
      </div>
    </div>
  )
}
