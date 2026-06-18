import { describe, it, expect } from 'vitest'
import { splitSentences, tokenizeSentences } from '../src/engine/tokenize.js'

function sentenceTexts(text: string): string[] {
  return splitSentences(text, 0, text.length).map((r) => text.slice(r.start, r.end))
}

describe('splitSentences', () => {
  it('splits on terminators', () => {
    expect(sentenceTexts('One thing. Two things! Three?')).toEqual([
      'One thing.',
      'Two things!',
      'Three?',
    ])
  })

  it('does not split common abbreviations', () => {
    expect(sentenceTexts('Mr. Lee spoke today.')).toEqual(['Mr. Lee spoke today.'])
    expect(sentenceTexts('We use e.g. this one.')).toEqual(['We use e.g. this one.'])
  })

  it('does not split inside decimals, versions, IPs, or domains', () => {
    expect(sentenceTexts('It grew 3.5 percent.')).toEqual(['It grew 3.5 percent.'])
    expect(sentenceTexts('Use v1.2.3 today.')).toEqual(['Use v1.2.3 today.'])
    expect(sentenceTexts('Ping 192.168.1.1 now.')).toEqual(['Ping 192.168.1.1 now.'])
    expect(sentenceTexts('Visit example.com soon.')).toEqual(['Visit example.com soon.'])
  })

  it('treats an ellipsis run as a single terminator', () => {
    expect(sentenceTexts('Wait... it works.')).toEqual(['Wait...', 'it works.'])
    expect(sentenceTexts('Wait… it works.')).toEqual(['Wait…', 'it works.'])
  })

  it('collapses multiple terminators into one boundary', () => {
    expect(sentenceTexts('Really?! Yes.')).toEqual(['Really?!', 'Yes.'])
  })

  it('handles a single word with no terminator', () => {
    expect(sentenceTexts('hello')).toEqual(['hello'])
  })

  it('returns nothing for whitespace only', () => {
    expect(sentenceTexts('   \n  ')).toEqual([])
  })
})

describe('tokenizeSentences', () => {
  it('marks non-initial capitalized words as proper nouns', () => {
    const s = tokenizeSentences('We met Alice today.', 0, 'We met Alice today.'.length)
    const words = s[0]!.words
    expect(words.map((w) => w.text)).toEqual(['We', 'met', 'Alice', 'today'])
    expect(words[0]!.isProperNoun).toBe(false)
    expect(words[2]!.isProperNoun).toBe(true)
  })

  it('keeps intra-word apostrophes and hyphens', () => {
    const text = "It's a well-known fact."
    const s = tokenizeSentences(text, 0, text.length)
    expect(s[0]!.words.map((w) => w.text)).toEqual(["It's", 'a', 'well-known', 'fact'])
  })

  it('reports word offsets that slice back to the word', () => {
    const text = 'Alpha beta gamma.'
    const s = tokenizeSentences(text, 0, text.length)
    for (const w of s[0]!.words) {
      expect(text.slice(w.start, w.end)).toBe(w.text)
    }
  })
})
