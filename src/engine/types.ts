export type Severity = 'error' | 'warning' | 'info'

export type Category =
  | 'longSentence'
  | 'mediumSentence'
  | 'passiveVoice'
  | 'adverb'
  | 'inflatedVocabulary'
  | 'wordyPhrase'
  | 'redundantPair'
  | 'filler'
  | 'hedge'
  | 'intensifier'
  | 'weaselAttribution'
  | 'selfAttribution'
  | 'apologeticPreamble'
  | 'credibilityKiller'
  | 'weakCloser'
  | 'throatClearing'
  | 'existenceStarter'
  | 'frontLoadedNegative'
  | 'commaBut'
  | 'emDash'
  | 'midSentenceColon'
  | 'tooManyCommas'
  | 'gradeTooHigh'
  | 'longParagraph'
  | 'wallOfText'
  | 'repeatedSentenceStart'

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'blockquote'
  | 'code'
  | 'table'
  | 'html'
  | 'thematicBreak'

export interface Span {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
}

export interface EditTarget {
  readonly replaceSpan: { readonly start: number; readonly end: number }
  readonly suggested: string | null
}

export interface Issue {
  readonly id: string
  readonly category: Category
  readonly severity: Severity
  readonly blocksClean: boolean
  readonly message: string
  readonly fixHint: string
  readonly span: Span
  readonly excerpt: string
  readonly replacement: string | null
  readonly editTarget: EditTarget
  readonly blockIndex: number
  readonly sentenceIndex: number | null
}

export interface BlockMetrics {
  readonly grade: number
  readonly gradeLabel: string
  readonly words: number
  readonly sentences: number
}

export interface SentenceInfo {
  readonly index: number
  readonly span: Span
  readonly grade: number
  readonly words: number
  readonly issueCount: number
}

export interface Block {
  readonly type: BlockType
  readonly index: number
  readonly level: number | null
  readonly prose: boolean
  readonly span: Span
  readonly metrics: BlockMetrics | null
  readonly sentences: readonly SentenceInfo[]
  readonly issueIds: readonly string[]
  readonly text?: string
}

export interface DocumentMetrics {
  readonly words: number
  readonly sentences: number
  readonly paragraphs: number
  readonly headings: number
  readonly syllables: number
  readonly grade: number
  readonly gradeLabel: string
  readonly avgWordsPerSentence: number
  readonly sentenceLengthStdDev: number
  readonly adverbDensityPer100Words: number
  readonly passiveSentencePct: number
  readonly longestParagraphWords: number
}

export interface Verdict {
  readonly clean: boolean
  readonly grade: number
  readonly gradeLabel: string
  readonly targetGrade: number
  readonly errorCount: number
  readonly warningCount: number
  readonly infoCount: number
  readonly totalIssues: number
  readonly hardestBlock: { readonly blockIndex: number; readonly grade: number } | null
  readonly fixFirst: readonly string[]
}

export interface AnalysisResult {
  readonly verdict: Verdict
  readonly document: {
    readonly metrics: DocumentMetrics
    readonly countsByCategory: Record<Category, number>
  }
  readonly blocks: readonly Block[]
  readonly issues: readonly Issue[]
  readonly truncated: boolean
  readonly totalAvailable: number
}

export interface AnalyzeOptions {
  readonly targetGrade: number
  readonly includeText: boolean
  readonly minSeverity: Severity
  readonly limit: number
  readonly offset: number
}

export type AnalyzeOptionsInput = {
  [K in keyof AnalyzeOptions]?: AnalyzeOptions[K] | undefined
}

export const DEFAULT_OPTIONS: AnalyzeOptions = {
  targetGrade: 8,
  includeText: false,
  minSeverity: 'info',
  limit: 200,
  offset: 0,
}
