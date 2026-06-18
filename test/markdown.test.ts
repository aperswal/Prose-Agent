import { describe, it, expect } from 'vitest'
import { parseDocument, mapOffset, crossesHardBoundary, type ProseContent } from '../src/engine/markdown.js'

describe('parseDocument', () => {
  it('classifies headings, paragraphs, and code blocks', () => {
    const md = '# Title\n\nA paragraph here.\n\n```\ncode block\n```\n'
    const blocks = parseDocument(md)
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'code'])
    expect(blocks[0]!.level).toBe(1)
    expect(blocks[2]!.prose).toBeNull()
  })

  it('neutralizes inline markdown into clean prose while segments map back to raw', () => {
    const md = 'We should **really** use it.'
    const block = parseDocument(md)[0]!
    const prose = block.prose as ProseContent
    expect(prose.text).toBe('We should really use it.')
    for (const seg of prose.segments) {
      expect(md.slice(seg.rawStart, seg.rawEnd)).toBe(prose.text.slice(seg.aStart, seg.aEnd))
    }
    const i = prose.text.indexOf('really')
    expect(md.slice(mapOffset(prose, i, false), mapOffset(prose, i + 'really'.length, true))).toBe('really')
  })

  it('keeps link text and drops the URL', () => {
    const md = 'See [the utilize page](http://utilize.example.com) now.'
    const prose = parseDocument(md)[0]!.prose as ProseContent
    expect(prose.text).toBe('See the utilize page now.')
    const i = prose.text.indexOf('utilize')
    expect(md.slice(mapOffset(prose, i, false), mapOffset(prose, i + 'utilize'.length, true))).toBe('utilize')
  })

  it('drops inline code content and marks a hard boundary so words do not merge', () => {
    const md = 'make `x` a decision'
    const prose = parseDocument(md)[0]!.prose as ProseContent
    expect(prose.text.includes('makea')).toBe(false)
    const start = prose.text.indexOf('make')
    const end = prose.text.indexOf('decision') + 'decision'.length
    expect(crossesHardBoundary(prose, start, end)).toBe(true)
  })

  it('treats GFM tables and thematic breaks as non-prose', () => {
    const md = 'Intro.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n'
    const types = parseDocument(md).map((b) => b.type)
    expect(types).toContain('table')
    expect(types).toContain('thematicBreak')
  })

  it('strips task-list checkboxes', () => {
    const md = '- [ ] do the thing\n- [x] done already\n'
    const blocks = parseDocument(md)
    expect(blocks.every((b) => b.type === 'listItem')).toBe(true)
    expect((blocks[0]!.prose as ProseContent).text).toBe('do the thing')
  })

  it('keeps hard-wrapped lines as one paragraph with words still separated', () => {
    const md = 'This sentence is wrapped\nacross two source lines.'
    const blocks = parseDocument(md)
    expect(blocks).toHaveLength(1)
    const prose = blocks[0]!.prose as ProseContent
    expect(prose.text.includes('wrappedacross')).toBe(false)
    for (const seg of prose.segments) {
      expect(md.slice(seg.rawStart, seg.rawEnd)).toBe(prose.text.slice(seg.aStart, seg.aEnd))
    }
  })
})
