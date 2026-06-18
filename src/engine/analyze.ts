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
} from './types.js'
import { DEFAULT_OPTIONS, type AnalyzeOptionsInput } from './types.js'
import { parseDocument, mapOffset, type ParsedBlock, type ProseContent } from './markdown.js'
import { tokenizeSentences, type Sentence } from './tokenize.js'
import { score, round1, gradeLabel } from './readability.js'
import { runBlockChecks, type RawFinding } from './checks.js'
import { CATEGORY_ORDER, meta, priority } from './registry.js'

interface PreIssue {
  category: Category
  blockIndex: number
  sentenceIndex: number | null
  rawStart: number
  rawEnd: number
  editStart: number
  editEnd: number
  replacement: string | null
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
      fixHint: m.fixHint,
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
