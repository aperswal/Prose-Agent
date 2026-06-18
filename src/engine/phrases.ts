import type { Category } from './types.js'
import { priority } from './registry.js'
import * as W from './wordlists.js'

export interface PhraseDef {
  readonly category: Category
  readonly key: string
  readonly wordCount: number
  readonly position: 'anywhere' | 'sentenceStart'
  readonly replacement: string | null
}

export function normalizeToken(token: string): string {
  return token.replace(/’/g, "'").toLowerCase()
}

function keyOf(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map(normalizeToken)
    .join(' ')
}

interface Source {
  readonly category: Category
  readonly phrases: readonly string[]
  readonly position: 'anywhere' | 'sentenceStart'
}

const SIMPLE_SOURCES: readonly Source[] = [
  { category: 'filler', phrases: W.fillers, position: 'anywhere' },
  { category: 'hedge', phrases: W.hedges, position: 'anywhere' },
  { category: 'intensifier', phrases: W.intensifiers, position: 'anywhere' },
  { category: 'redundantPair', phrases: W.redundantPairs, position: 'anywhere' },
  { category: 'weaselAttribution', phrases: W.weaselAttribution, position: 'anywhere' },
  { category: 'selfAttribution', phrases: W.selfAttribution, position: 'anywhere' },
  { category: 'credibilityKiller', phrases: W.credibilityKillers, position: 'anywhere' },
  { category: 'weakCloser', phrases: W.weakClosers, position: 'anywhere' },
  { category: 'apologeticPreamble', phrases: W.apologeticPreambles, position: 'sentenceStart' },
  { category: 'throatClearing', phrases: W.throatClearing, position: 'sentenceStart' },
  { category: 'existenceStarter', phrases: W.existenceStarters, position: 'sentenceStart' },
  { category: 'frontLoadedNegative', phrases: W.frontLoadedNegatives, position: 'sentenceStart' },
]

function buildTable(): { table: ReadonlyMap<string, PhraseDef>; maxWords: number } {
  const table = new Map<string, PhraseDef>()
  let maxWords = 1

  const add = (
    category: Category,
    phrase: string,
    position: 'anywhere' | 'sentenceStart',
    replacement: string | null,
  ): void => {
    const key = keyOf(phrase)
    const wordCount = key.split(' ').length
    maxWords = Math.max(maxWords, wordCount)
    const existing = table.get(key)
    if (existing && priority(existing.category) >= priority(category)) return
    table.set(key, { category, key, wordCount, position, replacement })
  }

  for (const src of SIMPLE_SOURCES) {
    for (const phrase of src.phrases) add(src.category, phrase, src.position, null)
  }
  for (const entry of W.wordyPhrases) add('wordyPhrase', entry.phrase, 'anywhere', entry.replacement ?? null)
  for (const entry of W.inflatedVocabulary) {
    add('inflatedVocabulary', entry.phrase, 'anywhere', entry.replacement ?? null)
  }

  return { table, maxWords }
}

const built = buildTable()
export const PHRASE_TABLE = built.table
export const MAX_PHRASE_WORDS = built.maxWords
