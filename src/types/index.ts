// ─── Groups ──────────────────────────
export interface Group {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
}

// ─── Collections ─────────────────────
export interface Collection {
  id: string
  name: string
  description: string
  group_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CollectionTreeNode {
  id: string
  name: string
  node_type: 'collection' | 'folder' | 'chain' | 'request'
  method?: string
  expect_status?: number
  children: CollectionTreeNode[]
}

// ─── Collection Items ────────────────
export interface CollectionItem {
  id: string
  collection_id: string
  parent_id: string | null
  type: 'folder' | 'chain' | 'request'
  name: string
  sort_order: number
  method: string
  url: string
  headers: string
  query_params: string
  body_type: string
  body_content: string
  extract_rules: string
  description: string
  expect_status: number
  poll_config: string
  protocol: string // 'http' | 'websocket'
  created_at: string
  updated_at: string
}

export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
  fieldType?: 'text' | 'file'
}

export interface HttpResponse {
  status: number
  status_text: string
  headers: KeyValuePair[]
  body: string
  time_ms: number
  size_bytes: number
}

// ─── Assertions ──────────────────────
export interface Assertion {
  id: string
  item_id: string
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

// ─── Execution ───────────────────────
export interface ExecutionResult {
  execution_id: string
  item_id: string
  item_name: string
  status: string
  response: HttpResponse | null
  assertion_results: AssertionResultItem[]
  error_message: string | null
}

export interface TestProgress {
  batch_id: string
  item_id: string
  item_name: string
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

export interface RunRecord {
  id: string
  status: string
  request_url: string
  request_method: string
  response_status: number | null
  response_headers: string
  response_body: string | null
  response_time_ms: number
  response_size: number
  assertion_results: string
  error_message: string | null
  executed_at: string
}

export interface ItemLastStatus {
  item_id: string
  status: string
  executed_at: string
  response_time_ms: number
  assertion_total: number
  assertion_passed: number
}

export interface HistoryEntry {
  id: string
  item_id: string
  status: string
  request_url: string
  request_method: string
  response_status: number | null
  response_time_ms: number
  executed_at: string
}

// ─── Environment ─────────────────────
export interface Environment {
  id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EnvVariable {
  id: string
  environment_id: string
  key: string
  value: string
  enabled: boolean
  sort_order: number
}

// ─── Streaming ───────────────────────
export interface StreamChunk {
  item_id: string
  chunk: string
  chunk_index: number
  done: boolean
}

// ─── Extract Rules ───────────────────
export interface ExtractRule {
  var_name: string
  source: 'json_body' | 'header' | 'status_code'
  expression: string
}

// ─── Chain ───────────────────────────
export interface ChainStepResult {
  step_index: number
  execution_result: ExecutionResult
  extracted_variables: Record<string, string>
}

export interface ChainResult {
  chain_id: string
  item_id: string
  item_name: string
  total_steps: number
  completed_steps: number
  status: string
  total_time_ms: number
  steps: ChainStepResult[]
  final_variables: Record<string, string>
}

export interface ChainProgress {
  chain_id: string
  item_id: string
  step_index: number
  step_name: string
  status: string
  total_steps: number
}
