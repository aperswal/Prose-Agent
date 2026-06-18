# Prose-Agent

A deterministic API that reads a markdown draft and tells a coding agent exactly what to rewrite. Send text, get back which sentence is too long, which word is inflated, which paragraph reads above the grade you asked for, and where each problem sits in the source. The agent fixes the issues, sends the draft again, and repeats until the verdict comes back clean.

There is no model behind it. The same markdown always returns the same JSON, so an agent can loop on it without surprises.

It ports the readability engine from [Prose](https://github.com/aperswal): a Flesch-Kincaid grade plus six writing detectors. On top of that it adds deterministic style checks. Those catch filler and hedges, inflated vocabulary (with plain replacements), weasel attribution, and em dashes.

## Quickstart

You need Node 20 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the Worker locally on `http://localhost:8787`. Ping it:

```bash
curl -s -X POST http://localhost:8787/analyze \
  -H 'content-type: application/json' \
  -d '{"markdown":"We should utilize the dashboard to optimize the workflow.","options":{"targetGrade":8}}'
```

You get a verdict and a list of issues. In the example above, `utilize` and `optimize` come back as blocking errors with the plain replacements `use` and `improve`.

## The API

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/analyze` | Analyze markdown and return the full report. This is the loop endpoint. |
| `GET` | `/checks` | The catalog of every check, with its severity and a fix hint. |
| `GET` | `/health` | Liveness. |
| `GET` | `/` | Plain-text usage. |

### Request

```json
{
  "markdown": "# Title\n\nYour draft goes here.",
  "options": {
    "targetGrade": 8,
    "includeText": false,
    "minSeverity": "info",
    "limit": 200,
    "offset": 0
  }
}
```

Every option is optional. `targetGrade` sets the reading grade the document has to hit. `minSeverity` filters the returned issues. `limit` and `offset` page through them. `includeText` adds the raw text of each block to the response when you want it.

### Response

```json
{
  "ok": true,
  "verdict": {
    "clean": false,
    "grade": 8.8,
    "gradeLabel": "Grade 9",
    "targetGrade": 8,
    "errorCount": 2,
    "warningCount": 4,
    "infoCount": 0,
    "totalIssues": 6,
    "hardestBlock": { "blockIndex": 1, "grade": 11.2 },
    "fixFirst": ["370e249a", "ed334c2d"]
  },
  "document": {
    "metrics": { "words": 18, "sentences": 2, "grade": 8.8, "passiveSentencePct": 50 },
    "countsByCategory": { "inflatedVocabulary": 2, "filler": 1 }
  },
  "blocks": [
    { "type": "heading", "index": 0, "metrics": { "grade": 3.1 }, "issueIds": [] }
  ],
  "issues": [
    {
      "id": "370e249a",
      "category": "inflatedVocabulary",
      "severity": "error",
      "blocksClean": true,
      "message": "Inflated word reads at a higher grade than it needs to.",
      "fixHint": "Use the plain word.",
      "span": { "start": 24, "end": 31, "line": 3, "column": 11 },
      "excerpt": "utilize",
      "replacement": "use",
      "editTarget": { "replaceSpan": { "start": 24, "end": 31 }, "suggested": "use" },
      "blockIndex": 1,
      "sentenceIndex": 0
    }
  ]
}
```

A few things make this easy to act on:

- **Spans are exact.** `span.start` and `span.end` are UTF-16 code units into the markdown you sent, so `markdown.slice(span.start, span.end)` equals `excerpt`. The same is true for `editTarget.replaceSpan`.
- **`verdict.clean` is the stop signal.** It is true when no blocking error remains and the grade sits at or below `targetGrade`, for the whole document and for every block long enough to score.
- **`verdict.fixFirst` is the worklist.** It lists issue ids in the order worth fixing, blocking errors first.
- **`hardestBlock` points at the paragraph or heading that scores worst**, so the agent can jump straight to it.

## The agent loop

```
1. POST the draft to /analyze.
2. If verdict.clean is true, stop. The draft is done.
3. Otherwise read issues. Apply the edits inside one response from the
   highest span.start down, so earlier offsets stay valid. Prefer the ids
   in verdict.fixFirst.
4. POST the rewritten draft. Go to step 2.
```

Applying edits from the bottom up matters. Once you change text near the end, the offsets before it still hold. So you can fix many issues in one pass before you send the draft again.

## What it checks

Errors block a clean verdict because they are mechanical and have one clear fix. They cover long sentences, inflated vocabulary, wordy phrases, redundant pairs, weasel attribution, em dashes, and a reading grade above your target.

Warnings are advisory and never block clean, because they are judgment calls a good sentence sometimes earns: passive voice, adverbs, filler, hedges, empty intensifiers, throat-clearing openers, and the rest. This split is what lets the loop finish. `GET /checks` returns the full list.

## Deploy to Cloudflare

The project is a Cloudflare Worker. Log in once, then deploy:

```bash
pnpm exec wrangler login
pnpm deploy
```

`wrangler login` opens a browser to authorize your Cloudflare account. After that, `pnpm deploy` publishes the Worker and prints its public URL. Point your agent at `https://<your-worker>.workers.dev/analyze` and the loop works the same as it does locally.

## Development

```bash
pnpm test        # run the test suite
pnpm typecheck   # strict TypeScript, no emit
pnpm lint        # ESLint
```

The engine under `src/engine` is pure TypeScript with no dependencies beyond a markdown parser, so every check is a unit test away. `src/index.ts` is the Worker entry, and `src/api` holds the request schema. The markdown parser ([mdast](https://github.com/syntax-tree/mdast)) gives the source offsets that every span is built on.

## Why it is deterministic

An agent that loops on a moving target never converges. So the engine avoids anything that could shift between runs: no clock, no randomness, no locale-sensitive sorting. Issues sort by a total order on their position, ids are a stable hash of the issue, and grades round to one decimal. Run the same markdown twice and the bytes match.
