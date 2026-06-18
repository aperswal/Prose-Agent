import { sentenceAbbreviations } from './wordlists.js'

export interface Word {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly isProperNoun: boolean
}

export interface Sentence {
  readonly start: number
  readonly end: number
  readonly words: readonly Word[]
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch) || ch === "'" || ch === '’' || ch === '-'
}

function isTerminator(ch: string): boolean {
  return ch === '.' || ch === '!' || ch === '?' || ch === '…'
}

function isClosing(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === ')' || ch === ']' || ch === '}' || ch === '”' || ch === '’' || ch === '»'
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch)
}

function skipWhitespace(text: string, from: number, to: number): number {
  let i = from
  while (i < to && /\s/.test(text[i] as string)) i += 1
  return i
}

function trimEnd(text: string, lo: number, hi: number): number {
  let end = hi
  while (end > lo && /\s/.test(text[end - 1] as string)) end -= 1
  return end
}

function isLikelyAbbreviation(text: string, dotIndex: number, lo: number): boolean {
  let tokenStart = dotIndex
  let hops = 0
  while (tokenStart > lo && hops < 16) {
    const prev = text[tokenStart - 1] as string
    if (/\s/.test(prev)) break
    tokenStart -= 1
    hops += 1
  }
  const token = text.slice(tokenStart, dotIndex + 1).toLowerCase()
  if (sentenceAbbreviations.has(token)) return true

  const prevCh = dotIndex > lo ? (text[dotIndex - 1] as string) : ''
  if (isLetter(prevCh) && prevCh === prevCh.toUpperCase() && prevCh !== prevCh.toLowerCase()) {
    const twoBack = dotIndex - 2 >= lo ? (text[dotIndex - 2] as string) : ''
    if (twoBack === '' || !isLetter(twoBack)) return true
  }
  return false
}

export function splitSentences(text: string, lo: number, hi: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let sentenceStart = skipWhitespace(text, lo, hi)
  if (sentenceStart >= hi) return ranges

  let i = sentenceStart
  while (i < hi) {
    const ch = text[i] as string
    if (!isTerminator(ch)) {
      i += 1
      continue
    }

    let runEnd = i
    while (runEnd + 1 < hi && isTerminator(text[runEnd + 1] as string)) runEnd += 1
    const afterTerm = runEnd + 1

    let sentEnd = afterTerm
    while (sentEnd < hi && isClosing(text[sentEnd] as string)) sentEnd += 1
    const boundaryFollows = sentEnd >= hi || /\s/.test(text[sentEnd] as string)
    if (!boundaryFollows) {
      i = afterTerm
      continue
    }

    const isSingleDot = ch === '.' && runEnd === i
    if (isSingleDot && isLikelyAbbreviation(text, i, sentenceStart)) {
      i = afterTerm
      continue
    }

    ranges.push({ start: sentenceStart, end: sentEnd })
    sentenceStart = skipWhitespace(text, sentEnd, hi)
    i = sentenceStart
  }

  if (sentenceStart < hi) {
    const end = trimEnd(text, sentenceStart, hi)
    if (end > sentenceStart) ranges.push({ start: sentenceStart, end })
  }
  return ranges
}

export function tokenizeWords(text: string, lo: number, hi: number): { start: number; end: number; text: string }[] {
  const words: { start: number; end: number; text: string }[] = []
  let i = lo
  while (i < hi) {
    if (isWordChar(text[i] as string)) {
      const start = i
      while (i < hi && isWordChar(text[i] as string)) i += 1
      words.push({ start, end: i, text: text.slice(start, i) })
    } else {
      i += 1
    }
  }
  return words
}

export function tokenizeSentences(text: string, lo: number, hi: number): Sentence[] {
  const out: Sentence[] = []
  for (const range of splitSentences(text, lo, hi)) {
    const raw = tokenizeWords(text, range.start, range.end)
    if (raw.length === 0) continue
    const words: Word[] = raw.map((w, idx) => {
      const first = w.text[0] as string
      const capitalized = isLetter(first) && first === first.toUpperCase() && first !== first.toLowerCase()
      return { start: w.start, end: w.end, text: w.text, isProperNoun: capitalized && idx > 0 }
    })
    out.push({ start: range.start, end: range.end, words })
  }
  return out
}
