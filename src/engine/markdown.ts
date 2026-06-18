import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { BlockType } from './types.js'

export interface Segment {
  readonly rawStart: number
  readonly rawEnd: number
  readonly aStart: number
  readonly aEnd: number
}

export interface ProseContent {
  readonly text: string
  readonly segments: readonly Segment[]
  readonly hardBoundaries: readonly number[]
}

export interface ParsedBlock {
  readonly type: BlockType
  readonly level: number | null
  readonly rawStart: number
  readonly rawEnd: number
  readonly prose: ProseContent | null
}

const MAX_DEPTH = 64

interface MdNode {
  readonly type: string
  readonly depth?: number
  readonly value?: string
  readonly url?: string
  readonly children?: readonly MdNode[]
  readonly position?: { start: { offset?: number }; end: { offset?: number } }
}

class ProseBuilder {
  text = ''
  readonly segments: Segment[] = []
  readonly hardBoundaries: number[] = []
  private lastWasSpace = true

  appendText(value: string, rawStart: number): void {
    if (value.length === 0) return
    const prev = this.segments[this.segments.length - 1]
    const rawGap = prev !== undefined && rawStart !== prev.rawEnd
    if (rawGap && !this.lastWasSpace && !/^\s/.test(value)) this.hardBoundary()
    const aStart = this.text.length
    this.text += value
    this.segments.push({ rawStart, rawEnd: rawStart + value.length, aStart, aEnd: this.text.length })
    this.lastWasSpace = /\s$/.test(value)
  }

  hardBoundary(): void {
    this.hardBoundaries.push(this.text.length)
    if (!this.lastWasSpace) {
      this.text += ' '
      this.lastWasSpace = true
    }
  }

  softSpace(): void {
    if (!this.lastWasSpace) {
      this.text += ' '
      this.lastWasSpace = true
    }
  }
}

function rawStartOf(node: MdNode): number {
  return node.position?.start.offset ?? 0
}

function isBareUrlLink(node: MdNode): boolean {
  if (node.url === undefined) return false
  const children = node.children ?? []
  if (children.length !== 1) return false
  const only = children[0] as MdNode
  return only.type === 'text' && only.value === node.url
}

function walkInline(node: MdNode, b: ProseBuilder, depth: number): void {
  if (depth > MAX_DEPTH) return
  for (const child of node.children ?? []) {
    switch (child.type) {
      case 'text':
        b.appendText(child.value ?? '', child.position?.start.offset ?? 0)
        break
      case 'link':
      case 'linkReference':
        if (isBareUrlLink(child)) b.hardBoundary()
        else walkInline(child, b, depth + 1)
        break
      case 'emphasis':
      case 'strong':
      case 'delete':
        walkInline(child, b, depth + 1)
        break
      case 'break':
        b.softSpace()
        break
      case 'inlineCode':
      case 'image':
      case 'imageReference':
      case 'html':
      case 'footnoteReference':
        b.hardBoundary()
        break
      default:
        if (child.children && child.children.length > 0) walkInline(child, b, depth + 1)
        else b.hardBoundary()
    }
  }
}

function buildProse(node: MdNode): ProseContent {
  const b = new ProseBuilder()
  walkInline(node, b, 0)
  return { text: b.text, segments: b.segments, hardBoundaries: b.hardBoundaries }
}

function nonProse(node: MdNode, type: BlockType): ParsedBlock {
  return {
    type,
    level: null,
    rawStart: node.position?.start.offset ?? 0,
    rawEnd: node.position?.end.offset ?? 0,
    prose: null,
  }
}

function emitBlocks(node: MdNode, container: BlockType | null, depth: number, out: ParsedBlock[]): void {
  if (depth > MAX_DEPTH) return
  switch (node.type) {
    case 'heading':
      out.push({
        type: 'heading',
        level: node.depth ?? 1,
        rawStart: rawStartOf(node),
        rawEnd: node.position?.end.offset ?? 0,
        prose: buildProse(node),
      })
      return
    case 'paragraph':
      out.push({
        type: container ?? 'paragraph',
        level: container === 'listItem' ? depth : null,
        rawStart: rawStartOf(node),
        rawEnd: node.position?.end.offset ?? 0,
        prose: buildProse(node),
      })
      return
    case 'code':
      out.push(nonProse(node, 'code'))
      return
    case 'table':
      out.push(nonProse(node, 'table'))
      return
    case 'html':
      out.push(nonProse(node, 'html'))
      return
    case 'thematicBreak':
      out.push(nonProse(node, 'thematicBreak'))
      return
    case 'list':
      for (const child of node.children ?? []) emitBlocks(child, container, depth + 1, out)
      return
    case 'listItem':
      for (const child of node.children ?? []) emitBlocks(child, 'listItem', depth + 1, out)
      return
    case 'blockquote':
      for (const child of node.children ?? []) emitBlocks(child, 'blockquote', depth + 1, out)
      return
    case 'definition':
    case 'footnoteDefinition':
    case 'yaml':
    case 'toml':
      return
    default:
      for (const child of node.children ?? []) emitBlocks(child, container, depth, out)
  }
}

export class InputTooComplexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputTooComplexError'
  }
}

function maxBlockquoteDepth(markdown: string): number {
  let max = 0
  for (const line of markdown.split('\n')) {
    const prefix = /^[\s>]*/.exec(line)?.[0] ?? ''
    let depth = 0
    for (const ch of prefix) if (ch === '>') depth += 1
    if (depth > max) max = depth
  }
  return max
}

export function parseDocument(markdown: string): ParsedBlock[] {
  if (maxBlockquoteDepth(markdown) > MAX_DEPTH) {
    throw new InputTooComplexError('markdown nests blockquotes too deeply to parse')
  }
  let tree: MdNode
  try {
    tree = fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as unknown as MdNode
  } catch {
    throw new InputTooComplexError('markdown is too deeply nested to parse')
  }
  const out: ParsedBlock[] = []
  for (const child of tree.children ?? []) emitBlocks(child, null, 0, out)
  return out
}

export function mapOffset(content: ProseContent, aOffset: number, isEnd = false): number {
  const segs = content.segments
  if (segs.length === 0) return 0

  let lo = 0
  let hi = segs.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((segs[mid] as Segment).aStart <= aOffset) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  let idx = ans
  if (!isEnd) {
    if (aOffset >= (segs[ans] as Segment).aEnd && ans + 1 < segs.length && (segs[ans + 1] as Segment).aStart === aOffset) {
      idx = ans + 1
    }
  } else if ((segs[ans] as Segment).aStart === aOffset && ans > 0) {
    idx = ans - 1
  }

  const seg = segs[idx] as Segment
  const clamped = Math.max(seg.aStart, Math.min(aOffset, seg.aEnd))
  return seg.rawStart + (clamped - seg.aStart)
}

export function crossesHardBoundary(content: ProseContent, aStart: number, aEnd: number): boolean {
  for (const b of content.hardBoundaries) {
    if (b > aStart && b < aEnd) return true
  }
  return false
}

export function withinOneSegment(content: ProseContent, aStart: number, aEnd: number): boolean {
  for (const seg of content.segments) {
    if (aStart >= seg.aStart && aEnd <= seg.aEnd) return true
  }
  return false
}
