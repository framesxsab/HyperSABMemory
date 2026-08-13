# Contributing to HyperMemory

## Setup

```bash
npm install
npm test
npm run eval
npm run build
```

`npm run eval` is the MemoryBench-style recall gate (local only: no AWS, no SageMaker). It must stay green for open-source PRs.

## Direct access

```bash
npx hypermemory connect
npx hypermemory status
```

## Rules

- Reuse existing modules (`src/memory`, `src/harness`) before adding files.
- No new npm dependencies unless a PR explicitly justifies them.
- Keep Oh-My-Pi headers under 1500 tokens.
- Do not commit `.hypermemory/` stores or secrets.
