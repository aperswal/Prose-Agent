export interface Readability {
  readonly words: number
  readonly sentences: number
  readonly syllables: number
  readonly grade: number
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y'])

export function syllableCount(word: string): number {
  const lower = word.toLowerCase()
  if (lower.length === 0) return 0

  let count = 0
  let prevWasVowel = false
  for (const ch of lower) {
    const isVowel = VOWELS.has(ch)
    if (isVowel && !prevWasVowel) count += 1
    prevWasVowel = isVowel
  }
  if (lower.endsWith('e') && count > 1) count -= 1
  return Math.max(1, count)
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function score(words: readonly string[], sentences: number): Readability {
  const sentenceCount = Math.max(1, sentences)
  let syllables = 0
  for (const w of words) syllables += syllableCount(w)

  let grade = 0
  if (words.length > 0) {
    const wordsPerSentence = words.length / sentenceCount
    const syllablesPerWord = syllables / words.length
    grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59
  }

  return {
    words: words.length,
    sentences: sentenceCount,
    syllables,
    grade: round1(Math.max(0, grade)),
  }
}

export function gradeLabel(grade: number): string {
  const g = Math.round(grade)
  if (g <= 11) return `Grade ${Math.max(g, 1)}`
  if (g <= 16) return 'Undergrad'
  if (g <= 18) return 'Grad'
  return 'Post grad'
}
