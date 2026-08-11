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
    message: 'Sentence runs past 45 words, two sigma beyond ordinary prose.',
    fixHint: 'Split it where the and or the but lives.',
  },
  commaSplice: {
    severity: 'error',
    blocksClean: true,
    priority: 87,
    message: 'Comma joins two complete sentences.',
    fixHint: 'Replace the comma with a period, or add a conjunction.',
  },
  runOnClauses: {
    severity: 'error',
    blocksClean: true,
    priority: 85,
    message: 'Full clauses strung together with commas.',
    fixHint: 'Split them into separate sentences.',
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
    message: 'Long sentence in an already-long stretch, with no short relief nearby.',
    fixHint: 'Shorten it, or drop a short sentence in front of it.',
  },
  monotoneRhythm: {
    severity: 'warning',
    blocksClean: false,
    priority: 64,
    message: 'Consecutive sentences run the same length.',
    fixHint: 'Cut one to under 10 words or merge two.',
  },
  lateVerb: {
    severity: 'warning',
    blocksClean: false,
    priority: 61,
    message: 'Main clause arrives late, so the reader holds uninterpreted setup.',
    fixHint: 'Put the main clause first and let the rest refine it.',
  },
  negationFirst: {
    severity: 'warning',
    blocksClean: false,
    priority: 59,
    message: 'Defines by negation before affirmation.',
    fixHint: 'State what it is, then what it is not.',
  },
  assertThenReverse: {
    severity: 'warning',
    blocksClean: false,
    priority: 57,
    message: 'Asserts a claim in order to reverse it.',
    fixHint: 'State the real claim first.',
  },
  nounPile: {
    severity: 'warning',
    blocksClean: false,
    priority: 55,
    message: 'Stacked nouns leave the relationships between them unstated.',
    fixHint: 'Unpack the stack into a clause with prepositions.',
  },
  unknownAcronym: {
    severity: 'warning',
    blocksClean: false,
    priority: 53,
    message: 'Acronym never introduced.',
    fixHint: 'Write the words out, or describe the thing first and attach the name after.',
  },
  elegantVariation: {
    severity: 'warning',
    blocksClean: false,
    priority: 49,
    message: 'Two words from one synonym set; a changed word signals a changed referent.',
    fixHint: 'If both name the same action, keep one.',
  },
  placeholderNoun: {
    severity: 'warning',
    blocksClean: false,
    priority: 47,
    message: 'Placeholder noun stands in for the thing itself.',
    fixHint: 'Name the thing directly.',
  },
  nominalization: {
    severity: 'warning',
    blocksClean: false,
    priority: 46,
    message: 'Nominalization hides the action inside an abstract noun.',
    fixHint: 'Use the verb inside the noun.',
  },
  authenticityWord: {
    severity: 'warning',
    blocksClean: false,
    priority: 43,
    message: 'Authenticity word asserts sincerity instead of adding content.',
    fixHint: 'Cut it.',
  },
  comparisonFrame: {
    severity: 'warning',
    blocksClean: false,
    priority: 41,
    message: 'Comparison imports a second domain the reader has to hold.',
    fixHint: 'Replace the analogy with a worked concrete example.',
  },
  ambiguousNecessity: {
    severity: 'info',
    blocksClean: false,
    priority: 39,
    message: 'Need hides whether this is necessary or sufficient.',
    fixHint: 'Say requires or is enough, whichever you mean.',
  },
  meansThat: {
    severity: 'info',
    blocksClean: false,
    priority: 37,
    message: 'May collapse entailment into definition or cause.',
    fixHint: 'If this is entailment, write if P then Q.',
  },
  emphasisFragment: {
    severity: 'warning',
    blocksClean: false,
    priority: 31,
    message: 'Short sentence written for emphasis rather than content.',
    fixHint: 'Cut it, or fold the point into the neighboring sentence.',
  },
  modalDensity: {
    severity: 'info',
    blocksClean: false,
    priority: 28,
    message: 'High modal density reads as uncertainty.',
    fixHint: 'Check each can, may and might against whether the plain assertion is true.',
  },
  noShortSentence: {
    severity: 'warning',
    blocksClean: false,
    priority: 63,
    message: 'Long stretch with no short sentence.',
    fixHint: 'Cut this sentence to its main clause.',
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
  heavyWords: {
    severity: 'warning',
    blocksClean: false,
    priority: 44,
    message: 'Heavy word in a block that reads heavier than ordinary prose.',
    fixHint: 'Use a shorter word.',
  },
  chopped: {
    severity: 'info',
    blocksClean: false,
    priority: 33,
    message: 'Stretch of uniformly short sentences with no build.',
    fixHint: 'Merge two adjacent sentences that share a subject.',
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
