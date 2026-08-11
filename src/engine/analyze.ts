import type {
  AnalysisResult,
  AnalyzeOptions,
  Block,
  Category,
  DocumentMetrics,
  Issue,
  SentenceInfo,
  Severity,
  Span,
  Verdict,
  VoiceAxis,
  VoicePlacement,
} from './types.js'
import { DEFAULT_OPTIONS, type AnalyzeOptionsInput } from './types.js'
import { parseDocument, mapOffset, type ParsedBlock, type ProseContent } from './markdown.js'
import { tokenizeSentences, type Sentence } from './tokenize.js'
import { score, round1, gradeLabel } from './readability.js'
import { runBlockChecks, type RawFinding } from './checks.js'
import { CATEGORY_ORDER, meta, priority } from './registry.js'
import {
  acronymAllowlist,
  acronymIntroducers,
  modalVerbs,
  subjectPronouns,
  synonymSets,
} from './wordlists.js'

interface PreIssue {
  category: Category
  blockIndex: number
  sentenceIndex: number | null
  rawStart: number
  rawEnd: number
  editStart: number
  editEnd: number
  replacement: string | null
  fixHint?: string
}

interface BlockData {
  parsed: ParsedBlock
  index: number
  prose: ProseContent | null
  sentences: Sentence[]
  wordTexts: string[]
  grade: number
  adverbCount: number
  passiveSentenceCount: number
}

const MIN_GRADED_WORDS = 12
const ORDER_INDEX = new Map<Category, number>(CATEGORY_ORDER.map((c, i) => [c, i]))
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 }
const OVERLAP_GROUP = new Set<Category>([
  'filler',
  'hedge',
  'intensifier',
  'redundantPair',
  'wordyPhrase',
  'inflatedVocabulary',
  'weaselAttribution',
  'selfAttribution',
  'credibilityKiller',
  'weakCloser',
  'apologeticPreamble',
  'throatClearing',
  'existenceStarter',
  'frontLoadedNegative',
  'adverb',
  'heavyWords',
  'placeholderNoun',
  'authenticityWord',
  'comparisonFrame',
  'ambiguousNecessity',
  'meansThat',
  'nominalization',
  'elegantVariation',
])

function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function lineColumnIndex(markdown: string): number[] {
  const starts = [0]
  for (let i = 0; i < markdown.length; i += 1) {
    if (markdown[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function spanOf(lineStarts: number[], start: number, end: number): Span {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((lineStarts[mid] as number) <= start) lo = mid
    else hi = mid - 1
  }
  return { start, end, line: lo + 1, column: start - (lineStarts[lo] as number) + 1 }
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function isParagraphType(parsed: ParsedBlock): boolean {
  return parsed.type === 'paragraph' || parsed.type === 'listItem' || parsed.type === 'blockquote'
}

function buildBlockData(parsed: ParsedBlock, index: number): BlockData {
  if (!parsed.prose) {
    return {
      parsed,
      index,
      prose: null,
      sentences: [],
      wordTexts: [],
      grade: 0,
      adverbCount: 0,
      passiveSentenceCount: 0,
    }
  }
  const sentences = tokenizeSentences(parsed.prose.text, 0, parsed.prose.text.length)
  const wordTexts: string[] = []
  for (const s of sentences) for (const w of s.words) wordTexts.push(w.text)
  const grade = score(wordTexts, sentences.length).grade
  return { parsed, index, prose: parsed.prose, sentences, wordTexts, grade, adverbCount: 0, passiveSentenceCount: 0 }
}

function repeatedStartFindings(blocks: BlockData[]): { blockIndex: number; finding: RawFinding }[] {
  const flat: { blockIndex: number; sentenceIndex: number; word: Sentence['words'][number] }[] = []
  for (const b of blocks) {
    if (!b.prose) continue
    b.sentences.forEach((s, si) => {
      const first = s.words[0]
      if (first) flat.push({ blockIndex: b.index, sentenceIndex: si, word: first })
    })
  }
  const out: { blockIndex: number; finding: RawFinding }[] = []
  let runStart = 0
  while (runStart < flat.length) {
    let runEnd = runStart + 1
    const key = (flat[runStart] as (typeof flat)[number]).word.text.toLowerCase()
    while (
      runEnd < flat.length &&
      (flat[runEnd] as (typeof flat)[number]).word.text.toLowerCase() === key
    ) {
      runEnd += 1
    }
    if (runEnd - runStart >= 3) {
      for (let k = runStart + 2; k < runEnd; k += 1) {
        const item = flat[k] as (typeof flat)[number]
        out.push({
          blockIndex: item.blockIndex,
          finding: {
            category: 'repeatedSentenceStart',
            aStart: item.word.start,
            aEnd: item.word.end,
            editAStart: item.word.start,
            editAEnd: item.word.end,
            sentenceIndex: item.sentenceIndex,
            replacement: null,
          },
        })
      }
    }
    runStart = runEnd
  }
  return out
}

interface FlatSentence {
  blockIndex: number
  sentenceIndex: number
  sentence: Sentence
  length: number
}

function flattenSentences(blocks: BlockData[]): FlatSentence[] {
  const flat: FlatSentence[] = []
  for (const b of blocks) {
    if (!b.prose) continue
    b.sentences.forEach((s, si) => {
      flat.push({ blockIndex: b.index, sentenceIndex: si, sentence: s, length: s.words.length })
    })
  }
  return flat
}

function anchorFinding(item: FlatSentence, category: Category, fixHint: string): { blockIndex: number; finding: RawFinding } {
  return {
    blockIndex: item.blockIndex,
    finding: {
      category,
      aStart: item.sentence.start,
      aEnd: item.sentence.end,
      editAStart: item.sentence.start,
      editAEnd: item.sentence.end,
      sentenceIndex: item.sentenceIndex,
      replacement: null,
      fixHint,
    },
  }
}

const MONOTONE_RUN = 5
const MONOTONE_SPREAD = 5
const NO_SHORT_STRETCH = 10
const SHORT_WORDS = 12
const CHOPPED_STRETCH = 8
const CHOPPED_MAX = 18
const CHOPPED_MEAN = 14

function monotoneFindings(flat: FlatSentence[]): { blockIndex: number; finding: RawFinding }[] {
  const out: { blockIndex: number; finding: RawFinding }[] = []
  let i = 0
  while (i < flat.length) {
    const anchor = (flat[i] as FlatSentence).length
    let j = i + 1
    while (j < flat.length && Math.abs((flat[j] as FlatSentence).length - anchor) <= MONOTONE_SPREAD) j += 1
    const run = j - i
    if (run >= MONOTONE_RUN) {
      const lengths = flat.slice(i, j).map((f) => f.length)
      const min = Math.min(...lengths)
      const max = Math.max(...lengths)
      const mid = flat[i + (run >> 1)] as FlatSentence
      out.push(
        anchorFinding(
          mid,
          'monotoneRhythm',
          `${run} sentences in a row run ${min}–${max} words. Vary this one: cut it under 10 words or merge it into a neighbor.`,
        ),
      )
      i = j
    } else {
      i += 1
    }
  }
  return out
}

function noShortFindings(flat: FlatSentence[]): { blockIndex: number; finding: RawFinding }[] {
  const out: { blockIndex: number; finding: RawFinding }[] = []
  let i = 0
  while (i < flat.length) {
    if ((flat[i] as FlatSentence).length < SHORT_WORDS) {
      i += 1
      continue
    }
    let j = i
    while (j < flat.length && (flat[j] as FlatSentence).length >= SHORT_WORDS) j += 1
    const stretch = j - i
    if (stretch >= NO_SHORT_STRETCH) {
      let shortest = flat[i] as FlatSentence
      for (let k = i + 1; k < j; k += 1) {
        if ((flat[k] as FlatSentence).length < shortest.length) shortest = flat[k] as FlatSentence
      }
      out.push(
        anchorFinding(
          shortest,
          'noShortSentence',
          `${stretch} sentences with none under ${SHORT_WORDS} words. This is the shortest (${shortest.length} words); cut it to its main clause.`,
        ),
      )
    }
    i = j
  }
  return out
}

function choppedFindings(flat: FlatSentence[]): { blockIndex: number; finding: RawFinding }[] {
  const out: { blockIndex: number; finding: RawFinding }[] = []
  let i = 0
  while (i < flat.length) {
    if ((flat[i] as FlatSentence).length > CHOPPED_MAX) {
      i += 1
      continue
    }
    let j = i
    while (j < flat.length && (flat[j] as FlatSentence).length <= CHOPPED_MAX) j += 1
    const stretch = j - i
    if (stretch >= CHOPPED_STRETCH) {
      const mean = flat.slice(i, j).reduce((a, f) => a + f.length, 0) / stretch
      if (mean < CHOPPED_MEAN) {
        let anchor = flat[i + (stretch >> 1)] as FlatSentence
        let hint = `${stretch} short sentences in a row with no build. Merge two adjacent ones that share a subject.`
        for (let k = i + 1; k < j; k += 1) {
          const item = flat[k] as FlatSentence
          const firstWord = item.sentence.words[0]
          if (firstWord && subjectPronouns.has(firstWord.text.toLowerCase())) {
            anchor = item
            hint = `${stretch} short sentences in a row with no build. This one starts with a pronoun; merge it into the previous sentence.`
            break
          }
        }
        out.push(anchorFinding(anchor, 'chopped', hint))
      }
    }
    i = j
  }
  return out
}

function rhythmFindings(blocks: BlockData[]): { blockIndex: number; finding: RawFinding }[] {
  const flat = flattenSentences(blocks)
  return [...monotoneFindings(flat), ...noShortFindings(flat), ...choppedFindings(flat)]
}

interface FlatWord {
  blockIndex: number
  sentenceIndex: number
  word: Sentence['words'][number]
  prev: Sentence['words'][number] | null
  prevPrev: Sentence['words'][number] | null
  precededByParen: boolean
}

function flattenWords(blocks: BlockData[]): FlatWord[] {
  const flat: FlatWord[] = []
  for (const b of blocks) {
    const prose = b.prose
    if (!prose) continue
    b.sentences.forEach((s, si) => {
      s.words.forEach((w, wi) => {
        flat.push({
          blockIndex: b.index,
          sentenceIndex: si,
          word: w,
          prev: wi > 0 ? (s.words[wi - 1] as Sentence['words'][number]) : null,
          prevPrev: wi > 1 ? (s.words[wi - 2] as Sentence['words'][number]) : null,
          precededByParen: w.start > 0 && prose.text[w.start - 1] === '(',
        })
      })
    })
  }
  return flat
}

function wordFinding(item: FlatWord, category: Category, fixHint?: string): { blockIndex: number; finding: RawFinding } {
  return {
    blockIndex: item.blockIndex,
    finding: {
      category,
      aStart: item.word.start,
      aEnd: item.word.end,
      editAStart: item.word.start,
      editAEnd: item.word.end,
      sentenceIndex: item.sentenceIndex,
      replacement: null,
      ...(fixHint !== undefined ? { fixHint } : {}),
    },
  }
}

const ACRONYM_DENSITY = 3

function isAcronymToken(text: string): boolean {
  if (!/^[A-Za-z]{2,6}$/.test(text)) return false
  let caps = 0
  for (const ch of text) if (ch >= 'A' && ch <= 'Z') caps += 1
  return caps >= 2
}

function acronymKey(text: string): string {
  return text.endsWith('s') ? text.slice(0, -1) : text
}

function acronymFindings(flat: FlatWord[]): { blockIndex: number; finding: RawFinding }[] {
  const introduced = new Set<string>()
  for (const item of flat) {
    if (!isAcronymToken(item.word.text)) continue
    const prev = item.prev ? item.prev.text.toLowerCase() : null
    const prevPrev = item.prevPrev ? item.prevPrev.text.toLowerCase() : null
    if (
      item.precededByParen ||
      (prev !== null && acronymIntroducers.has(prev)) ||
      (prev === 'as' && prevPrev === 'known')
    ) {
      introduced.add(acronymKey(item.word.text))
    }
  }
  const out: { blockIndex: number; finding: RawFinding }[] = []
  const seen = new Set<string>()
  const perBlock = new Map<number, Set<string>>()
  for (const item of flat) {
    const raw = item.word.text
    if (!isAcronymToken(raw)) continue
    const text = acronymKey(raw)
    if (acronymAllowlist.has(raw) || acronymAllowlist.has(text) || introduced.has(text)) continue
    if (!seen.has(text)) {
      seen.add(text)
      out.push(wordFinding(item, 'unknownAcronym'))
    }
    const blockSet = perBlock.get(item.blockIndex) ?? new Set<string>()
    if (!blockSet.has(text)) {
      blockSet.add(text)
      perBlock.set(item.blockIndex, blockSet)
      if (blockSet.size === ACRONYM_DENSITY) {
        out.push(
          wordFinding(
            item,
            'unknownAcronym',
            `${ACRONYM_DENSITY} acronyms in this paragraph. Rewrite with words.`,
          ),
        )
      }
    }
  }
  return out
}

const SYNONYM_LOOKUP = new Map<string, { set: number; lemma: string }>(
  synonymSets.flatMap((set, si) =>
    set.flatMap((forms) => forms.map((form) => [form, { set: si, lemma: forms[0] as string }] as const)),
  ),
)

function variationFindings(flat: FlatWord[]): { blockIndex: number; finding: RawFinding }[] {
  const out: { blockIndex: number; finding: RawFinding }[] = []
  const firstLemma = new Map<number, string>()
  const flagged = new Set<number>()
  for (const item of flat) {
    const hit = SYNONYM_LOOKUP.get(item.word.text.toLowerCase())
    if (!hit || item.word.isProperNoun) continue
    const existing = firstLemma.get(hit.set)
    if (existing === undefined) {
      firstLemma.set(hit.set, hit.lemma)
    } else if (existing !== hit.lemma && !flagged.has(hit.set)) {
      flagged.add(hit.set)
      out.push(
        wordFinding(
          item,
          'elegantVariation',
          `'${existing}' appears earlier in the document. If both name the same action, keep one.`,
        ),
      )
    }
  }
  return out
}

const MODAL_MIN_WORDS = 100
const MODAL_PER_100 = 3

function modalFindings(flat: FlatWord[]): { blockIndex: number; finding: RawFinding }[] {
  if (flat.length < MODAL_MIN_WORDS) return []
  const modals = flat.filter(
    (item) => modalVerbs.has(item.word.text.toLowerCase()) && !item.word.isProperNoun,
  )
  const density = (modals.length / flat.length) * 100
  if (density <= MODAL_PER_100) return []
  const countByBlock = new Map<number, number>()
  for (const m of modals) countByBlock.set(m.blockIndex, (countByBlock.get(m.blockIndex) ?? 0) + 1)
  let heaviest = -1
  let heaviestCount = 0
  for (const [blockIndex, count] of countByBlock) {
    if (count > heaviestCount || (count === heaviestCount && blockIndex < heaviest)) {
      heaviest = blockIndex
      heaviestCount = count
    }
  }
  const anchor = modals.find((m) => m.blockIndex === heaviest) as FlatWord
  return [
    wordFinding(
      anchor,
      'modalDensity',
      `${modals.length} modals in ${flat.length} words. Check each can, may and might against whether the plain assertion is true.`,
    ),
  ]
}

function lexiconFindings(blocks: BlockData[]): { blockIndex: number; finding: RawFinding }[] {
  const flat = flattenWords(blocks)
  return [...acronymFindings(flat), ...variationFindings(flat), ...modalFindings(flat)]
}

function collapseOverlaps(pre: PreIssue[]): PreIssue[] {
  const removed = new Set<number>()
  const byBlock = new Map<number, number[]>()
  for (let i = 0; i < pre.length; i += 1) {
    const p = pre[i] as PreIssue
    if (!OVERLAP_GROUP.has(p.category)) continue
    const list = byBlock.get(p.blockIndex) ?? []
    list.push(i)
    byBlock.set(p.blockIndex, list)
  }

  for (const indices of byBlock.values()) {
    indices.sort((x, y) => {
      const a = pre[x] as PreIssue
      const b = pre[y] as PreIssue
      return cmp(a.rawStart, b.rawStart) || cmp(b.rawEnd, a.rawEnd)
    })
    for (let i = 0; i < indices.length; i += 1) {
      const oi = indices[i] as number
      if (removed.has(oi)) continue
      const a = pre[oi] as PreIssue
      for (let j = i + 1; j < indices.length; j += 1) {
        const oj = indices[j] as number
        const b = pre[oj] as PreIssue
        if (b.rawStart >= a.rawEnd) break
        if (removed.has(oj)) continue
        const pa = priority(a.category)
        const pb = priority(b.category)
        if (pb > pa || (pb === pa && cmpStr(b.category, a.category) < 0)) {
          removed.add(oi)
          break
        }
        removed.add(oj)
      }
    }
  }
  return pre.filter((_, i) => !removed.has(i))
}

export function analyze(markdown: string, options: AnalyzeOptionsInput = {}): AnalysisResult {
  const opts: AnalyzeOptions = {
    targetGrade: options.targetGrade ?? DEFAULT_OPTIONS.targetGrade,
    includeText: options.includeText ?? DEFAULT_OPTIONS.includeText,
    minSeverity: options.minSeverity ?? DEFAULT_OPTIONS.minSeverity,
    limit: options.limit ?? DEFAULT_OPTIONS.limit,
    offset: options.offset ?? DEFAULT_OPTIONS.offset,
  }
  const lineStarts = lineColumnIndex(markdown)
  const parsedBlocks = parseDocument(markdown)
  const blocks = parsedBlocks.map((p, i) => buildBlockData(p, i))

  const pre: PreIssue[] = []
  const proseFindingsByBlock: RawFinding[][] = blocks.map(() => [])

  for (const b of blocks) {
    if (!b.prose) continue
    proseFindingsByBlock[b.index] = runBlockChecks(b.prose, b.sentences)
  }
  for (const { blockIndex, finding } of repeatedStartFindings(blocks)) {
    ;(proseFindingsByBlock[blockIndex] as RawFinding[]).push(finding)
  }
  for (const { blockIndex, finding } of rhythmFindings(blocks)) {
    ;(proseFindingsByBlock[blockIndex] as RawFinding[]).push(finding)
  }
  for (const { blockIndex, finding } of lexiconFindings(blocks)) {
    ;(proseFindingsByBlock[blockIndex] as RawFinding[]).push(finding)
  }

  for (const b of blocks) {
    const prose = b.prose
    if (!prose) continue
    const findings = proseFindingsByBlock[b.index] as RawFinding[]
    const passiveSentences = new Set<number>()
    for (const f of findings) {
      if (f.category === 'adverb') b.adverbCount += 1
      if (f.category === 'passiveVoice' && f.sentenceIndex !== null) passiveSentences.add(f.sentenceIndex)
      pre.push({
        category: f.category,
        blockIndex: b.index,
        sentenceIndex: f.sentenceIndex,
        rawStart: mapOffset(prose, f.aStart, false),
        rawEnd: mapOffset(prose, f.aEnd, true),
        editStart: mapOffset(prose, f.editAStart, false),
        editEnd: mapOffset(prose, f.editAEnd, true),
        replacement: f.replacement,
        ...(f.fixHint !== undefined ? { fixHint: f.fixHint } : {}),
      })
    }
    b.passiveSentenceCount = passiveSentences.size

    const words = b.wordTexts.length
    if (b.grade > opts.targetGrade && words >= MIN_GRADED_WORDS) {
      pre.push(blockFinding('gradeTooHigh', b))
    }
    if (isParagraphType(b.parsed) && (b.sentences.length > 5 || words > 100)) {
      pre.push(blockFinding('longParagraph', b))
    }
    if (words >= 200) {
      pre.push(blockFinding('wallOfText', b))
    }
  }

  const survivors = collapseOverlaps(pre)
  survivors.sort(
    (a, b) =>
      cmp(a.rawStart, b.rawStart) ||
      cmp(a.rawEnd, b.rawEnd) ||
      cmp(ORDER_INDEX.get(a.category) ?? 0, ORDER_INDEX.get(b.category) ?? 0) ||
      cmpStr(markdown.slice(a.rawStart, a.rawEnd), markdown.slice(b.rawStart, b.rawEnd)),
  )

  const idSeen = new Map<string, number>()
  const issues: Issue[] = survivors.map((p) => {
    const m = meta(p.category)
    const excerpt = markdown.slice(p.rawStart, p.rawEnd)
    const baseKey = `${p.category}|${p.rawStart}|${p.rawEnd}|${m.message}`
    const occ = idSeen.get(baseKey) ?? 0
    idSeen.set(baseKey, occ + 1)
    return {
      id: fnv1a(`${baseKey}|${occ}`),
      category: p.category,
      severity: m.severity,
      blocksClean: m.blocksClean,
      message: m.message,
      fixHint: p.fixHint ?? m.fixHint,
      span: spanOf(lineStarts, p.rawStart, p.rawEnd),
      excerpt,
      replacement: p.replacement,
      editTarget: { replaceSpan: { start: p.editStart, end: p.editEnd }, suggested: p.replacement },
      blockIndex: p.blockIndex,
      sentenceIndex: p.sentenceIndex,
    }
  })

  const document = buildDocumentMetrics(blocks)
  const outputBlocks = buildBlocks(markdown, lineStarts, blocks, issues, opts)
  const verdict = buildVerdict(blocks, issues, document, opts)
  const countsByCategory = buildCounts(issues)

  const minRank = SEVERITY_RANK[opts.minSeverity]
  const filtered = issues.filter((i) => SEVERITY_RANK[i.severity] >= minRank)
  const totalAvailable = filtered.length
  const paged = filtered.slice(opts.offset, opts.offset + opts.limit)

  return {
    verdict,
    document: { metrics: document, countsByCategory },
    blocks: outputBlocks,
    issues: paged,
    truncated: opts.offset + opts.limit < totalAvailable,
    totalAvailable,
  }
}

function blockFinding(category: Category, b: BlockData): PreIssue {
  return {
    category,
    blockIndex: b.index,
    sentenceIndex: null,
    rawStart: b.parsed.rawStart,
    rawEnd: b.parsed.rawEnd,
    editStart: b.parsed.rawStart,
    editEnd: b.parsed.rawEnd,
    replacement: null,
  }
}

const VOICE_MIN_SENTENCES = 8
const VOICE_NORMS = {
  meanSentenceLength: { mean: 21.4, sd: 4.2, targetMin: null, targetMax: null },
  lengthVariance: { mean: 0.51, sd: 0.14, targetMin: 0.5, targetMax: 1.5 },
  alternation: { mean: 0.52, sd: 0.12, targetMin: 0.5, targetMax: 1.5 },
  wordWeight: { mean: 1.72, sd: 0.15, targetMin: -1.5, targetMax: -1 },
} as const

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function voiceAxis(value: number, norm: (typeof VOICE_NORMS)[keyof typeof VOICE_NORMS]): VoiceAxis {
  const z = (value - norm.mean) / norm.sd
  const inBand =
    norm.targetMin === null || norm.targetMax === null ? null : z >= norm.targetMin && z <= norm.targetMax
  return { value: round2(value), z: round2(z), targetMin: norm.targetMin, targetMax: norm.targetMax, inBand }
}

function buildVoicePlacement(sentenceLengths: number[], syllables: number, words: number): VoicePlacement | null {
  if (sentenceLengths.length < VOICE_MIN_SENTENCES || words === 0) return null
  const meanLen = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
  const cv = meanLen > 0 ? stdDev(sentenceLengths) / meanLen : 0
  let deltaSum = 0
  for (let i = 1; i < sentenceLengths.length; i += 1) {
    deltaSum += Math.abs((sentenceLengths[i] as number) - (sentenceLengths[i - 1] as number))
  }
  const alternation = meanLen > 0 ? deltaSum / (sentenceLengths.length - 1) / meanLen : 0
  return {
    meanSentenceLength: voiceAxis(meanLen, VOICE_NORMS.meanSentenceLength),
    lengthVariance: voiceAxis(cv, VOICE_NORMS.lengthVariance),
    alternation: voiceAxis(alternation, VOICE_NORMS.alternation),
    wordWeight: voiceAxis(syllables / words, VOICE_NORMS.wordWeight),
  }
}

function buildDocumentMetrics(blocks: BlockData[]): DocumentMetrics {
  const allWords: string[] = []
  const sentenceLengths: number[] = []
  let sentences = 0
  let paragraphs = 0
  let headings = 0
  let adverbs = 0
  let passiveSentences = 0
  let longestParagraphWords = 0

  for (const b of blocks) {
    if (b.parsed.type === 'heading') headings += 1
    if (!b.prose) continue
    if (isParagraphType(b.parsed)) {
      paragraphs += 1
      longestParagraphWords = Math.max(longestParagraphWords, b.wordTexts.length)
    }
    for (const w of b.wordTexts) allWords.push(w)
    for (const s of b.sentences) sentenceLengths.push(s.words.length)
    sentences += b.sentences.length
    adverbs += b.adverbCount
    passiveSentences += b.passiveSentenceCount
  }

  const readability = score(allWords, sentences)
  const words = allWords.length
  return {
    words,
    sentences,
    paragraphs,
    headings,
    syllables: readability.syllables,
    grade: readability.grade,
    gradeLabel: gradeLabel(readability.grade),
    avgWordsPerSentence: sentences > 0 ? round1(words / sentences) : 0,
    sentenceLengthStdDev: round1(stdDev(sentenceLengths)),
    adverbDensityPer100Words: words > 0 ? round1((adverbs / words) * 100) : 0,
    passiveSentencePct: sentences > 0 ? round1((passiveSentences / sentences) * 100) : 0,
    longestParagraphWords,
    voicePlacement: buildVoicePlacement(sentenceLengths, readability.syllables, words),
  }
}

function buildBlocks(
  markdown: string,
  lineStarts: number[],
  blocks: BlockData[],
  issues: Issue[],
  opts: AnalyzeOptions,
): Block[] {
  const idsByBlock = new Map<number, string[]>()
  const issuesBySentence = new Map<string, number>()
  for (const issue of issues) {
    const list = idsByBlock.get(issue.blockIndex) ?? []
    list.push(issue.id)
    idsByBlock.set(issue.blockIndex, list)
    if (issue.sentenceIndex !== null) {
      const key = `${issue.blockIndex}:${issue.sentenceIndex}`
      issuesBySentence.set(key, (issuesBySentence.get(key) ?? 0) + 1)
    }
  }

  return blocks.map((b) => {
    const span = spanOf(lineStarts, b.parsed.rawStart, b.parsed.rawEnd)
    const sentences: SentenceInfo[] = b.sentences.map((s, si) => {
      const wordTexts = s.words.map((w) => w.text)
      const sentenceSpan = b.prose
        ? spanOf(lineStarts, mapOffset(b.prose, s.start, false), mapOffset(b.prose, s.end, true))
        : span
      return {
        index: si,
        span: sentenceSpan,
        grade: score(wordTexts, 1).grade,
        words: wordTexts.length,
        issueCount: issuesBySentence.get(`${b.index}:${si}`) ?? 0,
      }
    })
    const block: Block = {
      type: b.parsed.type,
      index: b.index,
      level: b.parsed.level,
      prose: b.prose !== null,
      span,
      metrics: b.prose
        ? { grade: b.grade, gradeLabel: gradeLabel(b.grade), words: b.wordTexts.length, sentences: b.sentences.length }
        : null,
      sentences,
      issueIds: idsByBlock.get(b.index) ?? [],
      ...(opts.includeText ? { text: markdown.slice(b.parsed.rawStart, b.parsed.rawEnd) } : {}),
    }
    return block
  })
}

function buildVerdict(
  blocks: BlockData[],
  issues: Issue[],
  document: DocumentMetrics,
  opts: AnalyzeOptions,
): Verdict {
  let errorCount = 0
  let warningCount = 0
  let infoCount = 0
  for (const i of issues) {
    if (i.severity === 'error') errorCount += 1
    else if (i.severity === 'warning') warningCount += 1
    else infoCount += 1
  }

  const isGraded = (b: BlockData): boolean => b.prose !== null && b.wordTexts.length >= MIN_GRADED_WORDS

  let hardestBlock: { blockIndex: number; grade: number } | null = null
  for (const b of blocks) {
    if (!isGraded(b)) continue
    if (b.grade > opts.targetGrade && (hardestBlock === null || b.grade > hardestBlock.grade)) {
      hardestBlock = { blockIndex: b.index, grade: b.grade }
    }
  }

  const allBlocksUnderTarget = blocks.every((b) => !isGraded(b) || b.grade <= opts.targetGrade)
  const clean = errorCount === 0 && document.grade <= opts.targetGrade && allBlocksUnderTarget

  const ranked = issues
    .map((i) => i)
    .sort((a, b) => {
      const ra = a.blocksClean ? 0 : a.category === 'gradeTooHigh' ? 1 : 2
      const rb = b.blocksClean ? 0 : b.category === 'gradeTooHigh' ? 1 : 2
      return cmp(ra, rb) || cmp(priority(b.category), priority(a.category)) || cmp(a.span.start, b.span.start)
    })
  const fixFirst = ranked.slice(0, 20).map((i) => i.id)

  return {
    clean,
    grade: document.grade,
    gradeLabel: document.gradeLabel,
    targetGrade: opts.targetGrade,
    errorCount,
    warningCount,
    infoCount,
    totalIssues: issues.length,
    hardestBlock,
    fixFirst,
  }
}

function buildCounts(issues: Issue[]): Record<Category, number> {
  const counts = {} as Record<Category, number>
  for (const c of CATEGORY_ORDER) counts[c] = 0
  for (const i of issues) counts[i.category] += 1
  return counts
}
