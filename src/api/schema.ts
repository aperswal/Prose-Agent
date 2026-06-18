import { z } from 'zod'

export const MAX_MARKDOWN_CHARS = 100_000

export const analyzeRequestSchema = z.object({
  markdown: z
    .string({ required_error: 'markdown is required', invalid_type_error: 'markdown must be a string' })
    .min(1, 'markdown must not be empty')
    .max(MAX_MARKDOWN_CHARS, `markdown must be at most ${MAX_MARKDOWN_CHARS} characters`),
  options: z
    .object({
      targetGrade: z.number().min(1).max(30).optional(),
      includeText: z.boolean().optional(),
      minSeverity: z.enum(['info', 'warning', 'error']).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    })
    .strict()
    .optional(),
  })
  .strict()

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>
