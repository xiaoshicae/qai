import { useCollectionStore } from '@/stores/collection-store'
import CollectionOverview from '@/components/collection/collection-overview'
import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function WorkbenchView() {
  const { t } = useTranslation()
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

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mx-auto mb-4">
          <Zap className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-medium text-muted-foreground">{t('app.select_collection')}</h2>
        <p className="text-xs text-muted-foreground/60 mt-1">{t('app.select_collection_hint')}</p>
      </div>
    </div>
  )
}
