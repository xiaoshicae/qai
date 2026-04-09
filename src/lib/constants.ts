/** HTTP 方法列表 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const

/** HTTP 方法下拉选项 */
export const METHOD_OPTIONS = HTTP_METHODS.map((m) => ({ value: m, label: m }))

/** 提取规则来源选项 */
export const EXTRACT_SOURCE_OPTIONS = [
  { value: 'json_body', label: 'JSON Body' },
  { value: 'header', label: 'Header' },
  { value: 'status_code', label: 'Status Code' },
]

/** 协议选项 */
export const PROTOCOL_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'websocket', label: 'WS' },
]
