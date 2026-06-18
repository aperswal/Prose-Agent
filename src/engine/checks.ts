import type { Category } from './types.js'
import type { ProseContent } from './markdown.js'
import { withinOneSegment } from './markdown.js'
import type { Sentence, Word } from './tokenize.js'
import { PHRASE_TABLE, MAX_PHRASE_WORDS, normalizeToken } from './phrases.js'
import * as W from './wordlists.js'

export interface RawFinding {
  readonly category: Category
  readonly aStart: number
  readonly aEnd: number
  readonly editAStart: number
  readonly editAEnd: number
  readonly sentenceIndex: number | null
  readonly replacement: string | null
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
    const category: Category | null = n > 30 ? 'longSentence' : n >= 20 ? 'mediumSentence' : null
    if (!category) return
    out.push({
      category,
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

function commaFindings(prose: ProseContent, sentences: readonly Sentence[]): RawFinding[] {
  const out: RawFinding[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const slice = prose.text.slice(sentence.start, sentence.end)
    let commas = 0
    for (const ch of slice) if (ch === ',') commas += 1
    if (commas > 2) {
      out.push({
        category: 'tooManyCommas',
        aStart: sentence.start,
        aEnd: sentence.end,
        editAStart: sentence.start,
        editAEnd: sentence.end,
        sentenceIndex,
        replacement: null,
      })
    }
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
    ...commaFindings(prose, sentences),
    ...punctuationFindings(prose, sentences),
  ]
}
