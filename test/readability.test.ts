import { describe, it, expect } from 'vitest'
import { syllableCount, score, gradeLabel, round1 } from '../src/engine/readability.js'

describe('syllableCount', () => {
  it('counts contiguous vowel groups', () => {
    expect(syllableCount('cat')).toBe(1)
    expect(syllableCount('banana')).toBe(3)
    expect(syllableCount('readability')).toBe(5)
  })

  it('drops a silent trailing e but never goes below one (ported naive rule)', () => {
    expect(syllableCount('make')).toBe(1)
    expect(syllableCount('apple')).toBe(1)
    expect(syllableCount('e')).toBe(1)
  })

  it('returns zero for an empty string', () => {
    expect(syllableCount('')).toBe(0)
  })
})

describe('score', () => {
  it('returns grade zero for no words', () => {
    expect(score([], 0).grade).toBe(0)
  })

  it('rounds grade to one decimal so output round-trips', () => {
    const g = score(['the', 'committee', 'will', 'commence', 'deliberations'], 1).grade
    expect(g).toBe(round1(g))
    expect(String(g)).not.toMatch(/\d{3,}/)
  })

  it('clamps a tiny sentence to non-negative grade', () => {
    expect(score(['go'], 1).grade).toBeGreaterThanOrEqual(0)
  })
})

describe('gradeLabel', () => {
  it('maps grade bands', () => {
    expect(gradeLabel(3)).toBe('Grade 3')
    expect(gradeLabel(0)).toBe('Grade 1')
    expect(gradeLabel(13)).toBe('Undergrad')
    expect(gradeLabel(17)).toBe('Grad')
    expect(gradeLabel(20)).toBe('Post grad')
  })

  it('rounds half up at band boundaries deterministically', () => {
    expect(gradeLabel(11.5)).toBe('Undergrad')
    expect(gradeLabel(16.5)).toBe('Grad')
    expect(gradeLabel(18.5)).toBe('Post grad')
  })
})
