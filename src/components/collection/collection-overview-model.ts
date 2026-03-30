import type { CollectionTreeNode } from '@/types'

export interface FlatReq {
  id: string
  name: string
  method: string
  folder?: string
  expect_status?: number
}

export interface StepGroup {
  groupName: string
  groupId: string
  isChain: true
  steps: FlatReq[]
}

export type TableItem = FlatReq | StepGroup

export { BODY_TYPES } from '@/components/request/body-type-selector'

export function flattenTreeToTableItems(tree: CollectionTreeNode | undefined): TableItem[] {
  const tableItems: TableItem[] = []
  function flatten(node: CollectionTreeNode) {
    if (node.node_type === 'request') {
      tableItems.push({ id: node.id, name: node.name, method: node.method ?? 'GET', expect_status: node.expect_status })
    } else if (node.node_type === 'chain') {
      const steps: FlatReq[] = []
      for (const child of node.children) {
        if (child.node_type === 'request') {
          steps.push({ id: child.id, name: child.name, method: child.method ?? 'GET', expect_status: child.expect_status })
        }
      }
      tableItems.push({ groupName: node.name, groupId: node.id, isChain: true, steps })
    } else {
      for (const child of node.children) flatten(child)
    }
  }
  if (tree) for (const child of tree.children) flatten(child)
  return tableItems
}

export function allRequestsFromTableItems(tableItems: TableItem[]): FlatReq[] {
  return tableItems.flatMap((item) => ('isChain' in item ? item.steps : [item]))
}
