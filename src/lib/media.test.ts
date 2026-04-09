import { describe, it, expect } from 'vitest'
import { extractSSEContent, extractBase64Media, redactBase64Fields } from './media'

describe('extractSSEContent', () => {
  it('提取 OpenAI delta 格式', () => {
    const chunk = '{"choices":[{"delta":{"content":"hello"}}]}'
    expect(extractSSEContent(chunk)).toBe('hello')
  })

  it('空 content 返回空字符串', () => {
    const chunk = '{"choices":[{"delta":{"content":""}}]}'
    expect(extractSSEContent(chunk)).toBe('')
  })

  it('无效 JSON 返回 null', () => {
    expect(extractSSEContent('not json')).toBeNull()
  })

  it('[DONE] 信号返回 null', () => {
    expect(extractSSEContent('[DONE]')).toBeNull()
  })

  it('缺少 choices 字段返回 null', () => {
    expect(extractSSEContent('{"data":"test"}')).toBeNull()
  })

  it('delta 无 content 返回 null', () => {
    expect(extractSSEContent('{"choices":[{"delta":{}}]}')).toBeNull()
  })
})

describe('extractBase64Media', () => {
  // 生成一个足够长的 base64 字符串（>200 字符）
  const fakeBase64 = 'iVBOR' + 'A'.repeat(300)

  it('检测 image 字段', () => {
    const obj = { b64_json: fakeBase64 }
    const media = extractBase64Media(obj)
    expect(media).toHaveLength(1)
    expect(media[0].type).toBe('image')
    expect(media[0].path).toBe('b64_json')
  })

  it('检测嵌套对象中的媒体', () => {
    const obj = { data: [{ b64_json: fakeBase64 }] }
    const media = extractBase64Media(obj)
    expect(media).toHaveLength(1)
    expect(media[0].path).toBe('data[0].b64_json')
  })

  it('空对象返回空数组', () => {
    expect(extractBase64Media({})).toEqual([])
  })

  it('短字符串不被检测', () => {
    const obj = { image: 'short' }
    expect(extractBase64Media(obj)).toEqual([])
  })

  it('URL 不被误检测', () => {
    const obj = { image: 'A'.repeat(300).replace('A', 'https://example.com/img') }
    // 包含 :// 的字符串不是 base64
    expect(extractBase64Media(obj)).toEqual([])
  })

  it('null 和原始值安全处理', () => {
    expect(extractBase64Media(null)).toEqual([])
    expect(extractBase64Media('string')).toEqual([])
    expect(extractBase64Media(42)).toEqual([])
  })
})

describe('redactBase64Fields', () => {
  const fakeBase64 = 'iVBOR' + 'A'.repeat(300)

  it('替换匹配的 base64 字段为占位文本', () => {
    const obj = { b64_json: fakeBase64, name: 'test' }
    const media = extractBase64Media(obj)
    const redacted = redactBase64Fields(obj, media) as Record<string, unknown>
    expect(redacted.name).toBe('test')
    expect(typeof redacted.b64_json).toBe('string')
    expect((redacted.b64_json as string)).toContain('[image base64')
  })

  it('无媒体时返回原结构', () => {
    const obj = { key: 'value' }
    const result = redactBase64Fields(obj, []) as Record<string, unknown>
    expect(result.key).toBe('value')
  })

  it('处理数组', () => {
    const arr = [{ b64_json: fakeBase64 }]
    const media = extractBase64Media(arr)
    const redacted = redactBase64Fields(arr, media) as Record<string, unknown>[]
    expect((redacted[0].b64_json as string)).toContain('[image base64')
  })
})
