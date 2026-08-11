import type { Category } from './types.js'
import type { ProseContent } from './markdown.js'
import { withinOneSegment } from './markdown.js'
import type { Sentence, Word } from './tokenize.js'
import { PHRASE_TABLE, MAX_PHRASE_WORDS, normalizeToken } from './phrases.js'
import { syllableCount } from './readability.js'
import * as W from './wordlists.js'

export interface RawFinding {
  readonly category: Category
  readonly aStart: number
  readonly aEnd: number
  readonly editAStart: number
  readonly editAEnd: number
  readonly sentenceIndex: number | null
  readonly replacement: string | null
  readonly fixHint?: string
}

export function verbMarker(word: string): boolean {
  if (W.finiteVerbs.has(word) || W.irregularPastTense.has(word)) return true
  if (word.endsWith('ed') && word.length >= 5) return true
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith("'s") && word.length >= 4) return true
  return false
}

function isPastParticiple(word: string): boolean {
  if (W.adjectivalPastParticiples.has(word)) return false
  if (W.irregularParticiples.has(word)) return true
  return word.endsWith('ed') && word.length >= 5
}

function skippableBetween(word: string): boolean {
  return word.endsWith('ly') || word === 'being' || word === 'been' || W.passiveInterrupters.has(word)
}

function phraseFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const words = sentence.words
    let i = 0
    while (i < words.length) {
      let matched = false
      const maxN = Math.min(MAX_PHRASE_WORDS, words.length - i)
      for (let n = maxN; n >= 1; n -= 1) {
        const span = words.slice(i, i + n)
        const key = span.map((w) => normalizeToken(w.text)).join(' ')
        const def = PHRASE_TABLE.get(key)
        if (!def) continue
        if (def.position === 'sentenceStart' && i !== 0) continue
        const aStart = (span[0] as Word).start
        const aEnd = (span[n - 1] as Word).end
        if (n > 1 && !withinOneSegment(prose, aStart, aEnd)) continue
        out.push({
          category: def.category,
          aStart,
          aEnd,
          editAStart: aStart,
          editAEnd: aEnd,
          sentenceIndex,
          replacement: def.replacement,
        })
        i += n
        matched = true
        break
      }
      if (!matched) i += 1
    }
  })
  return out
}

function adverbFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    for (const word of sentence.words) {
      const lower = normalizeToken(word.text)
      if (!lower.endsWith('ly') || lower.length < 4) continue
      if (W.adverbWhitelist.has(lower) || W.lyNonAdverbs.has(lower)) continue
      if (word.isProperNoun) continue
      out.push({
        category: 'adverb',
        aStart: word.start,
        aEnd: word.end,
        editAStart: word.start,
        editAEnd: word.end,
        sentenceIndex,
        replacement: null,
      })
    }
  })
  return out
}

function passiveFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const words = sentence.words
    let i = 0
    while (i < words.length) {
      const lower = normalizeToken((words[i] as Word).text)
      if (W.passiveAuxiliaries.has(lower)) {
        let j = i + 1
        let foundAt = -1
        let hops = 0
        while (j < words.length && hops < 3) {
          const cand = normalizeToken((words[j] as Word).text)
          if (W.adjectivalPastParticiples.has(cand)) break
          if (isPastParticiple(cand)) {
            foundAt = j
            break
          }
          if (!skippableBetween(cand)) break
          hops += 1
          j += 1
        }
        if (foundAt >= 0) {
          out.push({
            category: 'passiveVoice',
            aStart: (words[i] as Word).start,
            aEnd: (words[foundAt] as Word).end,
            editAStart: sentence.start,
            editAEnd: sentence.end,
            sentenceIndex,
            replacement: null,
          })
          i = foundAt + 1
          continue
        }
      }
      i += 1
    }
  })
  return out
}

function sentenceLengthFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const n = sentence.words.length
    if (n > 45) {
      out.push({
        category: 'longSentence',
        aStart: sentence.start,
        aEnd: sentence.end,
        editAStart: sentence.start,
        editAEnd: sentence.end,
        sentenceIndex,
        replacement: null,
      })
      return
    }
    if (n < 34) return
    const prev = sentences.slice(Math.max(0, sentenceIndex - 5), sentenceIndex)
    if (prev.length < 2) return
    const prevMean = prev.reduce((a, s) => a + s.words.length, 0) / prev.length
    if (prevMean <= 24) return
    out.push({
      category: 'mediumSentence',
      aStart: sentence.start,
      aEnd: sentence.end,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

function commaGap(text: string, a: Word, b: Word): number {
  const gap = text.slice(a.end, b.start)
  if (/["'‘’“”;]/.test(gap)) return -1
  const idx = gap.indexOf(',')
  return idx < 0 ? -1 : a.end + idx
}

function commaChunks(prose: ProseContent, sentence: Sentence): Word[][] {
  const chunks: Word[][] = []
  let current: Word[] = []
  const words = sentence.words
  for (let i = 0; i < words.length; i += 1) {
    current.push(words[i] as Word)
    const next = words[i + 1]
    if (next && commaGap(prose.text, words[i] as Word, next) >= 0) {
      chunks.push(current)
      current = []
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function commaSpliceFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const words = sentence.words
    if (words.length < 4) return
    const first = normalizeToken((words[0] as Word).text)
    if (W.clauseOpeners.has(first) || first.endsWith('ing')) return
    let preHasVerb = false
    for (let k = 0; k < words.length - 2; k += 1) {
      const w = words[k] as Word
      if (verbMarker(normalizeToken(w.text))) preHasVerb = true
      const next = words[k + 1] as Word
      const commaAt = commaGap(prose.text, w, next)
      if (commaAt < 0 || !preHasVerb) continue
      let j = k + 1
      let token = normalizeToken((words[j] as Word).text)
      if (W.coordinatingConjunctions.has(token)) continue
      if (W.conjunctiveAdverbs.has(token) && j + 2 < words.length) {
        j += 1
        token = normalizeToken((words[j] as Word).text)
      }
      if (!W.subjectPronouns.has(token)) continue
      const verb = words[j + 1]
      if (!verb || !verbMarker(normalizeToken(verb.text))) continue
      out.push({
        category: 'commaSplice',
        aStart: commaAt,
        aEnd: verb.end,
        editAStart: sentence.start,
        editAEnd: sentence.end,
        sentenceIndex,
        replacement: null,
      })
    }
  })
  return out
}

function runOnFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const chunks = commaChunks(prose, sentence)
    if (chunks.length < 5) return
    const tail = chunks.slice(1)
    const lastChunk = chunks[chunks.length - 1] as Word[]
    const lastStartsWithAndOr =
      lastChunk.length > 0 &&
      W.coordinatingConjunctions.has(normalizeToken((lastChunk[0] as Word).text))
    const isSeries = lastStartsWithAndOr && tail.every((c) => c.length <= 4)
    if (isSeries) return
    const verbChunks = chunks.filter((c) => c.some((w) => verbMarker(normalizeToken(w.text)))).length
    if (verbChunks < 2) return
    out.push({
      category: 'runOnClauses',
      aStart: sentence.start,
      aEnd: sentence.end,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

function commaButFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const slice = prose.text.slice(sentence.start, sentence.end)
    const re = /,\s+(but)\b/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(slice)) !== null) {
      const butStart = sentence.start + m.index + m[0].length - (m[1] as string).length
      out.push({
        category: 'commaBut',
        aStart: butStart,
        aEnd: butStart + 3,
        editAStart: sentence.start,
        editAEnd: sentence.end,
        sentenceIndex,
        replacement: null,
      })
    }
  })
  return out
}

function authenticityFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    sentence.words.forEach((word, wi) => {
      const lower = normalizeToken(word.text)
      if (!W.authenticityWords.has(lower) || word.isProperNoun) return
      const whitelist = W.authenticityWhitelist.get(lower)
      const next = sentence.words[wi + 1]
      if (whitelist && next && whitelist.has(normalizeToken(next.text))) return
      out.push({
        category: 'authenticityWord',
        aStart: word.start,
        aEnd: word.end,
        editAStart: word.start,
        editAEnd: word.end,
        sentenceIndex,
        replacement: null,
      })
    })
  })
  return out
}

function emphasisFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    if (sentence.words.length > 5) return
    const key = sentence.words.map((w) => normalizeToken(w.text)).join(' ')
    if (!W.emphasisFragments.has(key)) return
    out.push({
      category: 'emphasisFragment',
      aStart: sentence.start,
      aEnd: sentence.end,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

const LATE_VERB_WINDOW = 12
const LATE_VERB_MIN_WORDS = 14
const CLEFT_MIN_WORDS = 8

function lateVerbFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    if (prose.text[sentence.end - 1] === '?') return
    const words = sentence.words
    const first = normalizeToken((words[0] as Word).text)
    const cleft = first === 'what' && words.length >= CLEFT_MIN_WORDS
    const windowHasVerb = words
      .slice(0, LATE_VERB_WINDOW)
      .some((w) => verbMarker(normalizeToken(w.text)))
    const late = words.length >= LATE_VERB_MIN_WORDS && !windowHasVerb
    if (!cleft && !late) return
    out.push({
      category: 'lateVerb',
      aStart: sentence.start,
      aEnd: sentence.end,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

const NEGATION_FIRST_RE =
  /(\bis not\b|\bisn't\b|\bare not\b|\baren't\b)[\s\S]{0,80}?,\s*(it is\b|it's\b|they are\b|they're\b|but rather\b)/i

function negationFirstFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const slice = prose.text.slice(sentence.start, sentence.end)
    const m = NEGATION_FIRST_RE.exec(slice)
    if (!m) return
    out.push({
      category: 'negationFirst',
      aStart: sentence.start + m.index,
      aEnd: sentence.start + m.index + m[0].length,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

const REVERSAL_SETUPS = [
  'looks like',
  'look like',
  'seems to',
  'seem to',
  'seems like',
  'you might think',
  'appears to',
  'appear to',
] as const
const REVERSALS = [' but ', ' but,', 'does not', "doesn't", 'is not', "isn't", 'except'] as const
const NEXT_SENTENCE_REVERSALS: ReadonlySet<string> = new Set(['but', 'however'])

function assertThenReverseFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const slice = prose.text.slice(sentence.start, sentence.end).toLowerCase()
    let setupAt = -1
    for (const setup of REVERSAL_SETUPS) {
      const idx = slice.indexOf(setup)
      if (idx >= 0 && (setupAt < 0 || idx < setupAt)) setupAt = idx
    }
    if (setupAt < 0) return
    const rest = slice.slice(setupAt)
    let reversed = REVERSALS.some((r) => rest.includes(r))
    if (!reversed) {
      const next = sentences[sentenceIndex + 1]
      const nextFirst = next?.words[0]
      reversed = nextFirst !== undefined && NEXT_SENTENCE_REVERSALS.has(normalizeToken(nextFirst.text))
    }
    if (!reversed) return
    out.push({
      category: 'assertThenReverse',
      aStart: sentence.start,
      aEnd: sentence.end,
      editAStart: sentence.start,
      editAEnd: sentence.end,
      sentenceIndex,
      replacement: null,
    })
  })
  return out
}

const PILE_RUN = 4

function pileBreaking(word: Word): boolean {
  const lower = normalizeToken(word.text)
  if (/[0-9]/.test(lower) || lower.endsWith('ly')) return true
  if (verbMarker(lower)) return true
  return (
    W.pileBreakers.has(lower) ||
    W.subjectPronouns.has(lower) ||
    W.coordinatingConjunctions.has(lower) ||
    W.conjunctiveAdverbs.has(lower) ||
    W.clauseOpeners.has(lower) ||
    W.finiteVerbs.has(lower)
  )
}

function nounPileFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const words = sentence.words
    let i = 0
    while (i < words.length) {
      if (pileBreaking(words[i] as Word)) {
        i += 1
        continue
      }
      let j = i
      while (j < words.length && !pileBreaking(words[j] as Word)) j += 1
      const run = words.slice(i, j)
      const properCount = run.filter((w) => w.isProperNoun).length
      if (run.length >= PILE_RUN && properCount * 2 < run.length) {
        out.push({
          category: 'nounPile',
          aStart: (run[0] as Word).start,
          aEnd: (run[run.length - 1] as Word).end,
          editAStart: sentence.start,
          editAEnd: sentence.end,
          sentenceIndex,
          replacement: null,
        })
      }
      i = j
    }
  })
  return out
}

const NOMINAL_LOOKAHEAD = 3

function nominalizationFindings(sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const words = sentence.words
    for (let i = 0; i < words.length - 1; i += 1) {
      if (!W.weakVerbs.has(normalizeToken((words[i] as Word).text))) continue
      for (let j = i + 1; j <= Math.min(i + NOMINAL_LOOKAHEAD, words.length - 1); j += 1) {
        const lower = normalizeToken((words[j] as Word).text)
        const verb = W.nominalizations.get(lower)
        if (verb !== undefined) {
          out.push({
            category: 'nominalization',
            aStart: (words[i] as Word).start,
            aEnd: (words[j] as Word).end,
            editAStart: sentence.start,
            editAEnd: sentence.end,
            sentenceIndex,
            replacement: verb,
            fixHint: `Use the verb: ${verb}.`,
          })
          break
        }
        if (!W.nominalInterveners.has(lower)) break
      }
    }
  })
  return out
}

const WORD_WEIGHT_NORM = 1.72
const HEAVY_SYLLABLES = 4
const HEAVY_MIN_WORDS = 30
const HEAVY_MAX_FINDINGS = 5

function heavyWordFindings(sentences: readonly Sentence[]): RawFinding[] {
  const all: { word: Word; sentenceIndex: number; syllables: number }[] = []
  let totalSyllables = 0
  sentences.forEach((sentence, sentenceIndex) => {
    for (const word of sentence.words) {
      const syllables = syllableCount(word.text)
      totalSyllables += syllables
      all.push({ word, sentenceIndex, syllables })
    }
  })
  if (all.length < HEAVY_MIN_WORDS) return []
  if (totalSyllables / all.length <= WORD_WEIGHT_NORM) return []
  const heavy = all
    .filter((c) => c.syllables >= HEAVY_SYLLABLES && !c.word.isProperNoun)
    .sort((a, b) => b.syllables - a.syllables || a.word.start - b.word.start)
    .slice(0, HEAVY_MAX_FINDINGS)
  return heavy.map((c) => ({
    category: 'heavyWords' as Category,
    aStart: c.word.start,
    aEnd: c.word.end,
    editAStart: c.word.start,
    editAEnd: c.word.end,
    sentenceIndex: c.sentenceIndex,
    replacement: null,
  }))
}

function punctuationFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  const sentenceIndexAt = (offset: number): number | null => {
    for (let k = 0; k < sentences.length; k += 1) {
      const s = sentences[k] as Sentence
      if (offset >= s.start && offset < s.end) return k
    }
    return null
  }
  const text = prose.text

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string
    if (ch === '—') {
      out.push(mark('emDash', i, i + 1, sentenceIndexAt(i)))
    } else if (ch === '-' && text[i + 1] === '-') {
      out.push(mark('emDash', i, i + 2, sentenceIndexAt(i)))
      i += 1
    } else if (ch === ':') {
      const prev = i > 0 ? (text[i - 1] as string) : ''
      const next = text[i + 1] ?? ''
      const after = text[i + 2] ?? ''
      const prevIsLetter = /\p{L}/u.test(prev)
      const prevIsDigit = prev >= '0' && prev <= '9'
      const followsLowerWord = /\s/.test(next) && /\p{Ll}/u.test(after)
      if (prevIsLetter && !prevIsDigit && followsLowerWord) {
        const si = sentenceIndexAt(i)
        const wordsBefore = si === null ? 2 : (sentences[si] as Sentence).words.filter((w) => w.end <= i).length
        if (wordsBefore > 1) out.push(mark('midSentenceColon', i, i + 1, si))
      }
    }
  }
  return out
}

function mark(category: Category, aStart: number, aEnd: number, sentenceIndex: number | null): RawFinding {
  return { category, aStart, aEnd, editAStart: aStart, editAEnd: aEnd, sentenceIndex, replacement: null }
}

export function runBlockChecks(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  return [
    ...phraseFindings(prose, sentences),
    ...adverbFindings(sentences),
    ...passiveFindings(sentences),
    ...sentenceLengthFindings(sentences),
    ...commaSpliceFindings(prose, sentences),
    ...runOnFindings(prose, sentences),
    ...commaButFindings(prose, sentences),
    ...heavyWordFindings(sentences),
    ...authenticityFindings(sentences),
    ...emphasisFindings(sentences),
    ...lateVerbFindings(prose, sentences),
    ...negationFirstFindings(prose, sentences),
    ...assertThenReverseFindings(prose, sentences),
    ...nounPileFindings(sentences),
    ...nominalizationFindings(sentences),
    ...punctuationFindings(prose, sentences),
  ]
}
