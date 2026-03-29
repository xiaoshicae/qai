/**
 * JSON 响应中 base64 媒体字段的检测与提取
 *
 * 支持场景：
 * - OpenAI 图像生成: data[0].b64_json
 * - 通用 AI 接口: image_base64, turbo_image_base64 等
 * - 嵌套结构中的任意 base64 字段
 */

export interface EmbeddedMedia {
  path: string
  dataUrl: string
  type: 'image' | 'audio' | 'video'
  sizeBytes: number
}

// 字段名 → 媒体类型映射
const FIELD_HINTS: Record<string, EmbeddedMedia['type']> = {
  b64_json: 'image', b64_image: 'image', image_base64: 'image',
  turbo_image_base64: 'image', image_data: 'image',
  audio_base64: 'audio', audio_data: 'audio', b64_audio: 'audio',
  video_base64: 'video', video_data: 'video', b64_video: 'video',
}

// base64 magic bytes → 媒体类型
function detectTypeFromBytes(b64: string): EmbeddedMedia['type'] | null {
  const p = b64.slice(0, 8)
  if (p.startsWith('iVBOR')) return 'image'   // PNG
  if (p.startsWith('/9j/')) return 'image'     // JPEG
  if (p.startsWith('UklGR')) return 'image'    // WebP / RIFF
  if (p.startsWith('R0lGO')) return 'image'    // GIF
  if (p.startsWith('Qk')) return 'image'       // BMP
  return null
}

function guessMime(type: EmbeddedMedia['type'], b64: string): string {
  if (type === 'image') {
    const p = b64.slice(0, 8)
    if (p.startsWith('iVBOR')) return 'image/png'
    if (p.startsWith('/9j/')) return 'image/jpeg'
    if (p.startsWith('UklGR')) return 'image/webp'
    if (p.startsWith('R0lGO')) return 'image/gif'
    return 'image/png'
  }
  if (type === 'audio') return 'audio/wav'
  return 'video/mp4'
}

function isLikelyBase64(s: string): boolean {
  if (s.length < 200) return false
  if (s.includes('://')) return false
  return /^[A-Za-z0-9+/]{100}/.test(s)
}

/** 遍历 JSON，提取所有 base64 编码的媒体字段 */
export function extractBase64Media(obj: unknown, path = ''): EmbeddedMedia[] {
  const results: EmbeddedMedia[] = []
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => results.push(...extractBase64Media(item, `${path}[${i}]`)))
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${key}` : key
      if (typeof value === 'string' && isLikelyBase64(value)) {
        const type = FIELD_HINTS[key] ?? detectTypeFromBytes(value) ?? 'image'
        results.push({
          path: p,
          dataUrl: `data:${guessMime(type, value)};base64,${value}`,
          type,
          sizeBytes: Math.round(value.length * 3 / 4),
        })
      } else if (typeof value === 'object' && value !== null) {
        results.push(...extractBase64Media(value, p))
      }
    }
  }
  return results
}

/** 从 SSE chunk 中提取可读文本（兼容 OpenAI delta 格式） */
export function extractSSEContent(chunk: string): string | null {
  try {
    const json = JSON.parse(chunk)
    const delta = json.choices?.[0]?.delta?.content
    if (typeof delta === 'string') return delta
  } catch {}
  return null
}

/** 将 base64 字段替换为占位标签，返回新对象 */
export function redactBase64Fields(obj: unknown, media: EmbeddedMedia[], path = ''): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item, i) => redactBase64Fields(item, media, `${path}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${key}` : key
      const m = media.find(x => x.path === p)
      if (m) {
        const size = m.sizeBytes > 1048576
          ? `${(m.sizeBytes / 1048576).toFixed(1)} MB`
          : `${(m.sizeBytes / 1024).toFixed(1)} KB`
        result[key] = `[${m.type} base64, ${size}]`
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactBase64Fields(value, media, p)
      } else {
        result[key] = value
      }
    }
    return result
  }
  return obj
}
