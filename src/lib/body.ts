/**
 * Body 处理工具
 * 三个面板（request-panel、quick-test-dialog、collection-overview-edit-parts）
 * 共用的 body_content 序列化、解析、格式化逻辑
 */

import { safeJsonParse } from '@/lib/utils'
import type { KeyValuePair } from '@/types'

export type BodyType = 'none' | 'json' | 'form-data' | 'urlencoded' | 'form' | 'raw' | string

/** Body 键值对（等同于 KeyValuePair，明确在 body 场景中的语义） */
export type BodyKvItem = KeyValuePair

/** 是否为键值对类型的 body（form-data / urlencoded / form） */
export function isKvBody(bodyType: BodyType): boolean {
  return bodyType === 'form-data' || bodyType === 'urlencoded' || bodyType === 'form'
}

/** 解析 KV body_content 为数组（容错：非数组返回 []） */
export function parseKvBody(content: string | undefined | null): BodyKvItem[] {
  const parsed = safeJsonParse<BodyKvItem[] | unknown>(content, [])
  return Array.isArray(parsed) ? (parsed as BodyKvItem[]) : []
}

/** 加载请求时对 body_content 做美化处理（JSON 自动 indent；非 JSON 原样返回） */
export function prettyLoadBody(bodyType: BodyType, content: string | undefined | null): string {
  const raw = content ?? ''
  if (bodyType !== 'json' || !raw) return raw
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** 提交前的 body_content 序列化：KV 类型把数组序列化为 JSON 字符串 */
export function serializeBodyForSubmit(
  bodyType: BodyType,
  textContent: string,
  kvContent: BodyKvItem[],
): string {
  if (isKvBody(bodyType)) return JSON.stringify(kvContent)
  return textContent
}

/** 格式化 JSON 字符串（失败返回原文） */
export function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

/** 压缩 JSON 字符串（失败返回原文） */
export function compactJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content))
  } catch {
    return content
  }
}
