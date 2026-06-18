import type { Category, Severity } from './types.js'

export interface CategoryMeta {
  readonly category: Category
  readonly severity: Severity
  readonly blocksClean: boolean
  readonly priority: number
  readonly message: string
  readonly fixHint: string
}

const META: Record<Category, Omit<CategoryMeta, 'category'>> = {
  redundantPair: {
    severity: 'error',
    blocksClean: true,
    priority: 100,
    message: 'Redundant pair says the same thing twice.',
    fixHint: 'Cut one half.',
  },
  wordyPhrase: {
    severity: 'error',
    blocksClean: true,
    priority: 95,
    message: 'Wordy phrase adds length but no meaning.',
    fixHint: 'Replace it with the shorter form.',
  },
  gradeTooHigh: {
    severity: 'warning',
    blocksClean: false,
    priority: 90,
    message: 'This block reads above the target grade.',
    fixHint: 'Shorten the sentences and use plainer words.',
  },
  longSentence: {
    severity: 'error',
    blocksClean: true,
    priority: 88,
    message: 'Sentence runs over 30 words and carries more than one idea.',
    fixHint: 'Split it where the and or the but lives.',
  },
  inflatedVocabulary: {
    severity: 'error',
    blocksClean: true,
    priority: 82,
    message: 'Inflated word reads at a higher grade than it needs to.',
    fixHint: 'Use the plain word.',
  },
  emDash: {
    severity: 'error',
    blocksClean: true,
    priority: 80,
    message: 'Em dash is used as sentence punctuation.',
    fixHint: 'Replace it with a period, a comma, or parentheses.',
  },
  weaselAttribution: {
    severity: 'error',
    blocksClean: true,
    priority: 78,
    message: 'Vague attribution with no named source.',
    fixHint: 'Name the specific source or cut the claim.',
  },
  throatClearing: {
    severity: 'warning',
    blocksClean: false,
    priority: 72,
    message: 'Throat-clearing opener delays the point.',
    fixHint: 'Cut it and start at the point.',
  },
  frontLoadedNegative: {
    severity: 'warning',
    blocksClean: false,
    priority: 68,
    message: 'Front-loaded negative buries the point.',
    fixHint: 'Lead with what you do know.',
  },
  existenceStarter: {
    severity: 'warning',
    blocksClean: false,
    priority: 66,
    message: 'Weak existence starter hides the real subject.',
    fixHint: 'Rewrite with a real subject and verb.',
  },
  mediumSentence: {
    severity: 'warning',
    blocksClean: false,
    priority: 62,
    message: 'Sentence is on the long side.',
    fixHint: 'Tighten it, or split it if a reader has to slow down.',
  },
  wallOfText: {
    severity: 'warning',
    blocksClean: false,
    priority: 60,
    message: 'Wall of text with no break.',
    fixHint: 'Break it into shorter paragraphs.',
  },
  longParagraph: {
    severity: 'warning',
    blocksClean: false,
    priority: 58,
    message: 'Paragraph runs over five sentences or 100 words.',
    fixHint: 'Break it up.',
  },
  passiveVoice: {
    severity: 'warning',
    blocksClean: false,
    priority: 56,
    message: 'Passive voice hides who did the action.',
    fixHint: 'Rewrite so the subject does the action.',
  },
  apologeticPreamble: {
    severity: 'warning',
    blocksClean: false,
    priority: 52,
    message: 'Apologetic preamble undercuts what follows.',
    fixHint: 'Cut it and make the point.',
  },
  selfAttribution: {
    severity: 'warning',
    blocksClean: false,
    priority: 50,
    message: 'Over-attribution to yourself weakens the claim.',
    fixHint: 'State the claim directly.',
  },
  credibilityKiller: {
    severity: 'warning',
    blocksClean: false,
    priority: 48,
    message: 'Credibility-killer phrase asks for permission.',
    fixHint: 'Cut it.',
  },
  intensifier: {
    severity: 'warning',
    blocksClean: false,
    priority: 45,
    message: 'Empty intensifier adds no information.',
    fixHint: 'Cut it or use one exact word.',
  },
  weakCloser: {
    severity: 'warning',
    blocksClean: false,
    priority: 42,
    message: 'Weak closer trails off.',
    fixHint: 'End on the point.',
  },
  hedge: {
    severity: 'warning',
    blocksClean: false,
    priority: 40,
    message: 'Hedge softens the claim into nothing.',
    fixHint: 'State it directly or cut the hedge.',
  },
  midSentenceColon: {
    severity: 'warning',
    blocksClean: false,
    priority: 38,
    message: 'Colon used inside a sentence.',
    fixHint: 'Use a period or comma, or keep a colon only to introduce a label or a list.',
  },
  commaBut: {
    severity: 'warning',
    blocksClean: false,
    priority: 36,
    message: 'Comma before but may join two sentences.',
    fixHint: 'Consider splitting into two sentences.',
  },
  tooManyCommas: {
    severity: 'warning',
    blocksClean: false,
    priority: 35,
    message: 'More than two commas in one sentence.',
    fixHint: 'Split it.',
  },
  repeatedSentenceStart: {
    severity: 'warning',
    blocksClean: false,
    priority: 34,
    message: 'Three or more sentences in a row open with the same word.',
    fixHint: 'Vary the openings.',
  },
  filler: {
    severity: 'warning',
    blocksClean: false,
    priority: 32,
    message: 'Filler word fades out.',
    fixHint: 'Cut it.',
  },
  adverb: {
    severity: 'warning',
    blocksClean: false,
    priority: 30,
    message: 'Adverb props up a weak verb.',
    fixHint: 'Cut it, or pick a stronger verb that stands alone.',
  },
}

export const CATEGORY_ORDER: readonly Category[] = (
  Object.keys(META) as Category[]
).slice().sort((a, b) => {
  const pa = META[a].priority
  const pb = META[b].priority
  if (pa !== pb) return pb - pa
  return a < b ? -1 : a > b ? 1 : 0
})

export function meta(category: Category): CategoryMeta {
  return { category, ...META[category] }
}

export function priority(category: Category): number {
  return META[category].priority
}

export function blocksClean(category: Category): boolean {
  return META[category].blocksClean
}

export const CATALOG: readonly CategoryMeta[] = CATEGORY_ORDER.map((c) => meta(c))
