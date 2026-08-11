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

  it('a 46 word sentence is a blocking long sentence', () => {
    const long = `${Array.from({ length: 46 }, (_, i) => `word${i}`).join(' ')}.`
    const r = analyze(long, { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'longSentence')
    expect(issue?.severity).toBe('error')
    expect(issue?.editTarget.replaceSpan.start).toBe(0)
  })

  it('a lone 35 word sentence is no longer flagged', () => {
    const long = `${Array.from({ length: 35 }, (_, i) => `word${i}`).join(' ')}.`
    const r = analyze(long, { targetGrade: 99 })
    expect(r.issues.some((i) => i.category === 'longSentence' || i.category === 'mediumSentence')).toBe(false)
  })

  it('a 35 word sentence warns only inside an already-long stretch', () => {
    const s = (n: number): string => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`
    const longStretch = analyze(`${s(28)} ${s(27)} ${s(29)} ${s(35)}`, { targetGrade: 99 })
    expect(longStretch.issues.some((i) => i.category === 'mediumSentence')).toBe(true)
    const withRelief = analyze(`${s(6)} ${s(8)} ${s(35)}`, { targetGrade: 99 })
    expect(withRelief.issues.some((i) => i.category === 'mediumSentence')).toBe(false)
  })
})

describe('comma splices and run-ons', () => {
  it('flags a comma splice between two full clauses', () => {
    const r = analyze('The product launched, it broke immediately.', { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'commaSplice')
    expect(issue?.severity).toBe('error')
  })

  it('does not flag an introductory clause', () => {
    expect(categories('When it rains, it pours.')).not.toContain('commaSplice')
    expect(categories('After the launch, we celebrated the release.')).not.toContain('commaSplice')
  })

  it('does not flag dialogue attribution', () => {
    expect(categories('"We are done," she said.')).not.toContain('commaSplice')
  })

  it('does not flag a comma before a coordinating conjunction', () => {
    expect(categories('We shipped it, but it broke.')).not.toContain('commaSplice')
  })

  it('flags clauses strung together with commas', () => {
    const md =
      'The team shipped the release, the users complained loudly, support escalated every ticket, engineering reverted the deploy, nobody slept that night.'
    expect(categories(md, { targetGrade: 99 })).toContain('runOnClauses')
  })

  it('does not flag a plain series', () => {
    expect(categories('We ship to France, Canada, Mexico, Brazil, and Chile.', { targetGrade: 99 })).not.toContain(
      'runOnClauses',
    )
  })
})

describe('tier 1 phrase checks', () => {
  it('flags placeholder nouns', () => {
    expect(categories('The parser gives you a way to store structure.', { targetGrade: 99 })).toContain(
      'placeholderNoun',
    )
    expect(categories('No mechanism exists for declaring that.', { targetGrade: 99 })).not.toContain('placeholderNoun')
  })

  it('flags authenticity words but not whitelisted uses', () => {
    expect(categories('The genuine fix is simpler.', { targetGrade: 99 })).toContain('authenticityWord')
    expect(categories('The real number line is dense.', { targetGrade: 99 })).not.toContain('authenticityWord')
  })

  it('flags comparison frames', () => {
    expect(categories('A document is like a tree of nodes.', { targetGrade: 99 })).toContain('comparisonFrame')
  })

  it('flags ambiguous necessity as info', () => {
    const r = analyze('You need a schema for this.', { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'ambiguousNecessity')
    expect(issue?.severity).toBe('info')
  })

  it('flags means-that conditionals', () => {
    expect(categories('A conflict means that both copies changed.', { targetGrade: 99 })).toContain('meansThat')
  })

  it('flags closing restatements as weak closers', () => {
    expect(categories('In summary, the tree wins.', { targetGrade: 99 })).toContain('weakCloser')
  })

  it('flags emphasis fragments but not short claim sentences', () => {
    expect(categories('The cache invalidates itself. It works.', { targetGrade: 99 })).toContain('emphasisFragment')
    expect(categories('Two options exist.', { targetGrade: 99 })).not.toContain('emphasisFragment')
  })
})

describe('tier 2 token checks', () => {
  it('flags a pseudo-cleft late verb but not a question', () => {
    expect(
      categories('What the browser does when the user presses Enter differs between engines.', { targetGrade: 99 }),
    ).toContain('lateVerb')
    expect(categories('What is a monad?', { targetGrade: 99 })).not.toContain('lateVerb')
  })

  it('flags negation before affirmation', () => {
    expect(
      categories('The markup is not a stored document, it is a record of browser behavior.', { targetGrade: 99 }),
    ).toContain('negationFirst')
  })

  it('flags assert-then-reverse', () => {
    expect(
      categories('This looks like it solves the problem, but it does not.', { targetGrade: 99 }),
    ).toContain('assertThenReverse')
    expect(categories('This looks like a tree.', { targetGrade: 99 })).not.toContain('assertThenReverse')
  })

  it('flags a four-noun pile and passes the unpacked version', () => {
    expect(categories('The multi-step character composition pipeline broke.', { targetGrade: 99 })).toContain(
      'nounPile',
    )
    expect(
      categories('The way Japanese input combines several keystrokes into one character.', { targetGrade: 99 }),
    ).not.toContain('nounPile')
  })

  it('flags weak-verb nominalizations with the verb as replacement', () => {
    const r = analyze('Those four changes give convergence.', { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'nominalization')
    expect(issue?.replacement).toBe('converge')
    expect(categories('We perform a validation at the boundary.', { targetGrade: 99 })).toContain('nominalization')
    expect(categories('The validation runs at the boundary.', { targetGrade: 99 })).not.toContain('nominalization')
  })

  it('flags unknown acronyms once but not allowlisted or introduced ones', () => {
    const r = analyze('The DSL spec drives the generator. The DSL output is typed.', { targetGrade: 99 })
    expect(r.issues.filter((i) => i.category === 'unknownAcronym')).toHaveLength(1)
    expect(categories('The API returns JSON.', { targetGrade: 99 })).not.toContain('unknownAcronym')
    expect(
      categories('Data structures with this property are called CRDTs. Every CRDT converges.', { targetGrade: 99 }),
    ).not.toContain('unknownAcronym')
  })

  it('flags three acronyms in one paragraph with a density hint', () => {
    const r = analyze('The DSL feeds the AST into the IR before lowering.', { targetGrade: 99 })
    const density = r.issues.find((i) => i.category === 'unknownAcronym' && i.fixHint.includes('Rewrite with words'))
    expect(density).toBeDefined()
  })

  it('flags elegant variation across the document', () => {
    const md = 'Each browser produces different markup. Whatever markup the program emitted gets stored.'
    const r = analyze(md, { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'elegantVariation')
    expect(issue?.fixHint).toContain('produce')
  })

  it('flags modal density over long modal-heavy text', () => {
    const md = Array.from(
      { length: 8 },
      () => 'The cache can fail here, the disk may fill there, and the network might drop.',
    ).join(' ')
    expect(categories(md, { targetGrade: 99, limit: 1000 })).toContain('modalDensity')
  })
})

describe('rhythm', () => {
  const s = (n: number, tag: string): string => `${Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ')}.`

  it('flags a monotone run with a located recommendation', () => {
    const md = Array.from({ length: 6 }, (_, k) => s(15, `w${k}x`)).join(' ')
    const r = analyze(md, { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'monotoneRhythm')
    expect(issue).toBeDefined()
    expect(issue?.fixHint).toContain('sentences in a row')
  })

  it('flags a long stretch with no short sentence, anchored at the shortest', () => {
    const lens = [12, 18, 24, 12, 19, 25, 13, 20, 26, 14]
    const md = lens.map((n, k) => s(n, `q${k}x`)).join(' ')
    const r = analyze(md, { targetGrade: 99 })
    const issue = r.issues.find((i) => i.category === 'noShortSentence')
    expect(issue).toBeDefined()
    expect(issue?.fixHint).toContain('shortest')
  })

  it('varied writing raises no rhythm findings', () => {
    const lens = [5, 22, 9, 30, 6, 17, 11, 26]
    const md = lens.map((n, k) => s(n, `v${k}x`)).join(' ')
    const r = analyze(md, { targetGrade: 99 })
    expect(r.issues.some((i) => i.category === 'monotoneRhythm')).toBe(false)
    expect(r.issues.some((i) => i.category === 'noShortSentence')).toBe(false)
    expect(r.issues.some((i) => i.category === 'chopped')).toBe(false)
  })

  it('reports voice placement once a document has enough sentences', () => {
    const md = Array.from({ length: 8 }, (_, k) => s(15, `p${k}x`)).join(' ')
    const vp = analyze(md).document.metrics.voicePlacement
    expect(vp).not.toBeNull()
    expect(typeof vp?.lengthVariance.z).toBe('number')
    expect(vp?.wordWeight.targetMax).toBe(-1)
    expect(analyze('One line. Two lines here.').document.metrics.voicePlacement).toBeNull()
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
