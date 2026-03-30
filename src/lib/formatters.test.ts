import { describe, it, expect } from 'vitest'
import { formatDuration, formatSize } from './formatters'

describe('formatDuration', () => {
  it('formats milliseconds under 1s', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(1)).toBe('1ms')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('formats seconds for 1000ms+', () => {
    expect(formatDuration(1000)).toBe('1.00s')
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(2345)).toBe('2.35s')
    expect(formatDuration(10000)).toBe('10.00s')
  })
})

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 * 100)).toBe('100.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(1024 * 1024 * 3.5)).toBe('3.5 MB')
  })
})
