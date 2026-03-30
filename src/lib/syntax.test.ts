import { describe, it, expect } from 'vitest'
import { tokenize, TOKEN_COLORS } from './syntax'

describe('tokenize', () => {
  it('tokenizes simple key-value', () => {
    const tokens = tokenize('{"name": "John"}')
    const types = tokens.map((t) => t.type)
    expect(types).toContain('key')
    expect(types).toContain('string')
    expect(types).toContain('bracket')
  })

  it('tokenizes numbers', () => {
    const tokens = tokenize('{"age": 42}')
    const numToken = tokens.find((t) => t.type === 'number')
    expect(numToken).toBeDefined()
    expect(numToken!.text).toBe('42')
  })

  it('tokenizes negative numbers', () => {
    const tokens = tokenize('{"val": -3.14}')
    const numToken = tokens.find((t) => t.type === 'number')
    expect(numToken).toBeDefined()
    expect(numToken!.text).toBe('-3.14')
  })

  it('tokenizes booleans', () => {
    const tokens = tokenize('{"ok": true, "fail": false}')
    const bools = tokens.filter((t) => t.type === 'boolean')
    expect(bools.length).toBe(2)
    expect(bools[0].text).toBe('true')
    expect(bools[1].text).toBe('false')
  })

  it('tokenizes null', () => {
    const tokens = tokenize('{"data": null}')
    const nullToken = tokens.find((t) => t.type === 'null')
    expect(nullToken).toBeDefined()
    expect(nullToken!.text).toBe('null')
  })

  it('tokenizes brackets', () => {
    const tokens = tokenize('[{}]')
    const brackets = tokens.filter((t) => t.type === 'bracket')
    expect(brackets.map((b) => b.text)).toEqual(['[', '{', '}', ']'])
  })

  it('handles empty string', () => {
    const tokens = tokenize('')
    expect(tokens).toEqual([])
  })

  it('handles plain text', () => {
    const tokens = tokenize('not json')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.every((t) => t.type === 'plain')).toBe(true)
  })

  it('handles escaped strings', () => {
    const tokens = tokenize('{"msg": "say \\"hello\\""}')
    const str = tokens.find((t) => t.type === 'string')
    expect(str).toBeDefined()
    expect(str!.text).toContain('hello')
  })

  it('handles scientific notation', () => {
    const tokens = tokenize('{"val": 1.5e10}')
    const num = tokens.find((t) => t.type === 'number')
    expect(num).toBeDefined()
    expect(num!.text).toBe('1.5e10')
  })

  it('distinguishes key from string by colon', () => {
    const tokens = tokenize('{"key": "value"}')
    const key = tokens.find((t) => t.type === 'key')
    const str = tokens.find((t) => t.type === 'string')
    expect(key!.text).toBe('"key"')
    expect(str!.text).toBe('"value"')
  })
})

describe('TOKEN_COLORS', () => {
  it('has colors for all token types', () => {
    const expectedTypes = ['key', 'string', 'number', 'boolean', 'null', 'bracket']
    for (const type of expectedTypes) {
      expect(TOKEN_COLORS[type]).toBeDefined()
      expect(TOKEN_COLORS[type].length).toBeGreaterThan(0)
    }
  })

  it('uses dark: variant for dual theme', () => {
    expect(TOKEN_COLORS.key).toContain('dark:')
    expect(TOKEN_COLORS.string).toContain('dark:')
  })
})
