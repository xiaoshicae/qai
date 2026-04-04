/**
 * 共享样式常量
 *
 * 统一管理项目中的样式常量，确保UI一致性
 */

// ═══ 过渡时间 ═══
// 快速交互：hover/focus 状态
export const TRANSITION_FAST = 'duration-150'
// 标准交互：展开/关闭/通用
export const TRANSITION_NORMAL = 'duration-200'
// 慢速动画：进度条/加载
export const TRANSITION_SLOW = 'duration-300'

// ═══ 浮层菜单统一样式 ═══
export const MENU_CONTAINER_CLASS = 'rounded-xl glass-card p-1.5 shadow-2xl text-xs'
export const MENU_ITEM_CLASS = 'flex items-center gap-2 w-full px-3 py-2 rounded-lg cursor-pointer transition-colors text-left text-xs hover:bg-overlay/[0.06]'
export const MENU_DANGER_CLASS = 'flex items-center gap-2 w-full px-3 py-2 rounded-lg cursor-pointer transition-colors text-left text-xs text-destructive hover:bg-destructive/10'
export const MENU_DIVIDER_CLASS = 'h-px bg-overlay/[0.06] my-1'

// ═══ 状态颜色 ═══
export const STATUS_SUCCESS = 'text-success'
export const STATUS_WARNING = 'text-warning'
export const STATUS_ERROR = 'text-error'
export const STATUS_INFO = 'text-info'

// ═══ HTTP 方法颜色 ═══
export const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}
