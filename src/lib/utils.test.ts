import { describe, it, expect } from 'vitest'
import { cn } from './utils'

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
