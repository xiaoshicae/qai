export interface Collection {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export interface CollectionTreeNode {
  id: string
  name: string
  node_type: 'collection' | 'folder' | 'request'
  method?: string
  children: CollectionTreeNode[]
}

export interface ApiRequest {
  id: string
  collection_id: string
  folder_id: string | null
  name: string
  method: string
  url: string
  headers: string
  query_params: string
  body_type: string
  body_content: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
}

export interface HttpResponse {
  status: number
  status_text: string
  headers: KeyValuePair[]
  body: string
  time_ms: number
  size_bytes: number
}

export interface ExecutionResult {
  execution_id: string
  request_id: string
  request_name: string
  status: string
  response: HttpResponse | null
  assertion_results: AssertionResultItem[]
  error_message: string | null
}

export interface Assertion {
  id: string
  request_id: string
  type: string
  expression: string
  operator: string
  expected: string
  enabled: boolean
  sort_order: number
  created_at: string
}

export interface AssertionResultItem {
  assertion_id: string
  passed: boolean
  actual: string
  message: string
}

export interface TestProgress {
  batch_id: string
  request_id: string
  request_name: string
  status: string
  current: number
  total: number
}

export interface BatchResult {
  batch_id: string
  total: number
  passed: number
  failed: number
  errors: number
  total_time_ms: number
  results: ExecutionResult[]
}

export interface Environment {
  id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface HistoryEntry {
  id: string
  request_id: string
  status: string
  request_url: string
  request_method: string
  response_status: number | null
  response_time_ms: number
  executed_at: string
}

export interface EnvVariable {
  id: string
  environment_id: string
  key: string
  value: string
  enabled: boolean
  sort_order: number
}
