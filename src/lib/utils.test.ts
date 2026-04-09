import { describe, it, expect } from 'vitest'
import { cn, safeJsonParse, getStatusColor, isShortcutTarget } from './utils'

describe('cn', () => {
  it('单个类名', () => {
    expect(cn('foo')).toBe('foo')
  })

  it('多个类名', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('条件类名', () => {
    // eslint-disable-next-line no-constant-binary-expression
    expect(cn('foo', false && 'bar')).toBe('foo')
    // eslint-disable-next-line no-constant-binary-expression
    expect(cn('foo', true && 'bar')).toBe('foo bar')
  })

  it('tailwind-merge 去重', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('空输入', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })
})

describe('safeJsonParse', () => {
  it('解析有效 JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('解析数组', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3])
  })

  it('无效 JSON 返回 fallback', () => {
    expect(safeJsonParse('invalid', 'fallback')).toBe('fallback')
  })

  it('null 输入返回 fallback', () => {
    expect(safeJsonParse(null, [])).toEqual([])
  })

  it('undefined 输入返回 fallback', () => {
    expect(safeJsonParse(undefined, {})).toEqual({})
  })

  it('空字符串返回 fallback', () => {
    expect(safeJsonParse('', 'default')).toBe('default')
  })
})

describe('getStatusColor', () => {
  it('2xx → success', () => {
    expect(getStatusColor(200)).toBe('success')
    expect(getStatusColor(201)).toBe('success')
    expect(getStatusColor(299)).toBe('success')
  })

  it('4xx → destructive', () => {
    expect(getStatusColor(400)).toBe('destructive')
    expect(getStatusColor(404)).toBe('destructive')
    expect(getStatusColor(500)).toBe('destructive')
  })

  it('3xx → warning', () => {
    expect(getStatusColor(301)).toBe('warning')
    expect(getStatusColor(302)).toBe('warning')
  })

  it('1xx → warning', () => {
    expect(getStatusColor(100)).toBe('warning')
  })
})

describe('isShortcutTarget', () => {
  it('INPUT 元素返回 true', () => {
    const el = document.createElement('input')
    expect(isShortcutTarget(el)).toBe(true)
  })

  it('TEXTAREA 元素返回 true', () => {
    const el = document.createElement('textarea')
    expect(isShortcutTarget(el)).toBe(true)
  })

  it('SELECT 元素返回 true', () => {
    const el = document.createElement('select')
    expect(isShortcutTarget(el)).toBe(true)
  })

  it('contentEditable 元素返回 true', () => {
    const el = document.createElement('div')
    // jsdom 不完全支持 isContentEditable，直接 mock 属性
    Object.defineProperty(el, 'isContentEditable', { value: true })
    expect(isShortcutTarget(el)).toBe(true)
  })

  it('Monaco host 内元素返回 true', () => {
    const host = document.createElement('div')
    host.setAttribute('data-qai-monaco-host', '')
    const child = document.createElement('div')
    host.appendChild(child)
    document.body.appendChild(host)
    expect(isShortcutTarget(child)).toBe(true)
    document.body.removeChild(host)
  })

  it('普通 div 返回 false', () => {
    const el = document.createElement('div')
    expect(isShortcutTarget(el)).toBe(false)
  })

  it('null 返回 false', () => {
    expect(isShortcutTarget(null)).toBe(false)
  })
})
