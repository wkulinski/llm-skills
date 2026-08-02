# OWE Methodology Corpus

This corpus is the versioned quality baseline for OpenCode Workflow Economics.
It contains synthetic cases with hand-reviewed expectations for the evidence
layers used by the current analyzer.

The corpus intentionally covers:

- semantically coherent and mixed structural patterns;
- repeated micro-operations and broad reconnaissance;
- ordered overlap before a parent write;
- post-write and deliberate verification overlap;
- unordered and overlapping parent exposure;
- child completion from a nested subtree;
- exact command matches and no exact matches;
- missing parent timing;
- complete, incomplete, missing-usage, and missing-pricing steps.

Run the corpus checks with:

```bash
npx vitest run tests/skills/opencode-workflow-economics/corpus.test.mjs
```

The expectations describe the current methodology, not a desired future
classification. Changes to the methodology must update the corpus version and
expectations before later improvement stages are started.
