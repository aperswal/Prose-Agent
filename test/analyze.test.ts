import { describe, it, expect } from 'vitest'
import { analyze } from '../src/engine/analyze.js'
import type { Category } from '../src/engine/types.js'

const RICH = `# Restocking Guide

We should utilize the dashboard, you know, to optimize the workflow.

The report was reviewed by the team and it was quite literally the most incredibly long sentence that anyone on the whole entire team had ever seen before in their long careers here.

See [the utilize page](http://utilize.example.com) for more, but it was decided that we would proceed regardless of the cost.

\`\`\`ts
const x = utilize(y)
\`\`\`

Run the \`utilize\` helper now.
`

function categories(md: string, opts = {}): Category[] {
  return analyze(md, opts).issues.map((i) => i.category)
}

describe('analyze invariants', () => {
  it('every issue excerpt slices back to the raw markdown', () => {
    const result = analyze(RICH, { limit: 1000 })
    for (const issue of result.issues) {
      expect(RICH.slice(issue.span.start, issue.span.end)).toBe(issue.excerpt)
      expect(RICH.slice(issue.editTarget.replaceSpan.start, issue.editTarget.replaceSpan.end).length).toBeGreaterThan(0)
    }
  })

  it('is deterministic: identical JSON across two runs', () => {
    expect(JSON.stringify(analyze(RICH))).toBe(JSON.stringify(analyze(RICH)))
  })

  it('emits countsByCategory in a fixed canonical order with every category present', () => {
    const a = Object.keys(analyze('A short clean line.').document.countsByCategory)
    const b = Object.keys(analyze(RICH).document.countsByCategory)
    expect(a).toEqual(b)
  })
})

describe('convergence gate', () => {
  it('a short plain sentence is clean', () => {
    const r = analyze('The cat sat on the mat.', { targetGrade: 12 })
    expect(r.verdict.clean).toBe(true)
    expect(r.verdict.errorCount).toBe(0)
  })

  it('passive voice alone is advisory and never blocks clean', () => {
    const r = analyze('The report was reviewed by the team.', { targetGrade: 20 })
    expect(r.issues.some((i) => i.category === 'passiveVoice')).toBe(true)
    expect(r.verdict.errorCount).toBe(0)
    expect(r.verdict.clean).toBe(true)
  })

  it('adverbs alone are advisory', () => {
    const r = analyze('She moved the boxes carefully.', { targetGrade: 20 })
    expect(r.issues.some((i) => i.category === 'adverb')).toBe(true)
    expect(r.verdict.errorCount).toBe(0)
  })

  it('predicate adjectives are not flagged as passive', () => {
    const r = analyze('I am tired. She was excited. They are interested.', { targetGrade: 20 })
    expect(r.issues.some((i) => i.category === 'passiveVoice')).toBe(false)
  })

  it('intransitive predicate participles are not passive', () => {
    const r = analyze('The feature is done. The cache is gone. The app has grown.', { targetGrade: 20 })
    expect(r.issues.some((i) => i.category === 'passiveVoice')).toBe(false)
  })

  it('still catches passive across a parenthetical interrupter', () => {
    const r = analyze('The book was, after all, written by a famous author.', { targetGrade: 20 })
    expect(r.issues.some((i) => i.category === 'passiveVoice')).toBe(true)
  })

  it('inflated vocabulary blocks clean and carries a replacement', () => {
    const r = analyze('We utilize the tool.', { targetGrade: 20 })
    const issue = r.issues.find((i) => i.category === 'inflatedVocabulary')
    expect(issue?.severity).toBe('error')
    expect(issue?.replacement).toBe('use')
    expect(r.verdict.clean).toBe(false)
  })

  it('a 35 word sentence is a blocking long sentence', () => {
    const long = `${Array.from({ length: 35 }, (_, i) => `word${i}`).join(' ')}.`
    const r = analyze(long, { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'longSentence')
    expect(issue?.severity).toBe('error')
    expect(issue?.editTarget.replaceSpan.start).toBe(0)
  })
})

describe('markdown handling', () => {
  it('skips prose checks inside fenced code blocks', () => {
    expect(categories('```\nWe utilize this.\n```')).not.toContain('inflatedVocabulary')
  })

  it('skips inline code content', () => {
    expect(categories('Run the `utilize` helper.')).not.toContain('inflatedVocabulary')
    expect(categories('Run the utilize helper.')).toContain('inflatedVocabulary')
  })

  it('flags a banned word in link text but not in the URL', () => {
    expect(categories('See [the utilize page](http://example.com).')).toContain('inflatedVocabulary')
    expect(categories('See [the page](http://utilize.com).')).not.toContain('inflatedVocabulary')
  })

  it('flags em dashes as an error', () => {
    const r = analyze('I went home — it was already late.', { targetGrade: 99 })
    expect(r.issues.some((i) => i.category === 'emDash' && i.severity === 'error')).toBe(true)
  })

  it('never bleeds a span across adjacent inline links', () => {
    const md = '[utilize](http://x.com)[leverage](http://y.com) the tool.'
    const r = analyze(md, { targetGrade: 99, limit: 1000 })
    for (const issue of r.issues) {
      expect(md.slice(issue.span.start, issue.span.end)).toBe(issue.excerpt)
      expect(/[[\]()`*]/.test(issue.excerpt)).toBe(false)
      expect(issue.excerpt.includes('http')).toBe(false)
    }
  })

  it('drops autolink and bare-URL text from prose', () => {
    expect(categories('See <http://utilize.example.com/very/path> here.', { targetGrade: 99 })).not.toContain(
      'intensifier',
    )
    expect(categories('Visit http://utilize.example.com now.', { targetGrade: 99 })).not.toContain('inflatedVocabulary')
  })

  it('rejects pathologically deep nesting with a typed error, not an uncontrolled crash', () => {
    const deep = '>'.repeat(5000) + ' hello world\n'
    expect(() => analyze(deep)).toThrow(/too deeply/i)
  })
})

describe('overlap and granularity', () => {
  it('collapses an -ly intensifier to a single issue, not also an adverb', () => {
    const r = analyze('This is really important.', { targetGrade: 99 })
    const onReally = r.issues.filter((i) => i.excerpt === 'really')
    expect(onReally).toHaveLength(1)
    expect(onReally[0]!.category).toBe('intensifier')
  })

  it('does not grade-gate very short blocks where Flesch-Kincaid is meaningless', () => {
    const r = analyze('# Onboarding\n\nThe cat sat on the mat by the door.', { targetGrade: 8 })
    expect(r.issues.some((i) => i.category === 'gradeTooHigh' && i.blockIndex === 0)).toBe(false)
    expect(r.blocks[0]!.metrics).not.toBeNull()
  })

  it('reports a hardest block above target grade', () => {
    const md = `Easy line here.\n\nThe aforementioned infrastructure necessitates comprehensive reconfiguration throughout numerous interdependent organizational subsystems simultaneously.`
    const r = analyze(md, { targetGrade: 8 })
    expect(r.verdict.hardestBlock).not.toBeNull()
    expect(r.verdict.hardestBlock!.blockIndex).toBe(1)
  })
})

describe('options', () => {
  it('targetGrade gates the verdict', () => {
    const md = 'The committee will commence deliberations regarding the subsequent reconfiguration.'
    expect(analyze(md, { targetGrade: 99 }).verdict.grade).toBe(analyze(md, { targetGrade: 1 }).verdict.grade)
    expect(analyze(md, { targetGrade: 1 }).verdict.clean).toBe(false)
  })

  it('minSeverity filters the issue list but not the verdict counts', () => {
    const r = analyze(RICH, { minSeverity: 'error', limit: 1000 })
    expect(r.issues.every((i) => i.severity === 'error')).toBe(true)
    expect(r.verdict.warningCount).toBeGreaterThan(0)
  })

  it('paginates with truncated and totalAvailable', () => {
    const full = analyze(RICH, { limit: 1000 }).issues.length
    const page = analyze(RICH, { limit: 2 })
    expect(page.issues.length).toBeLessThanOrEqual(2)
    expect(page.totalAvailable).toBe(full)
    expect(page.truncated).toBe(full > 2)
  })
})
