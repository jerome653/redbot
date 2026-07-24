# ground-truth/ — the Argus Ground Truth Corpus

Charter, workflow, promotion rules and migration plan: **[`../AGTC.md`](../AGTC.md)**.

```
node ground-truth/build-corpus.mjs     # assemble cases from data/ + authored truth (skips existing)
node ground-truth/validate.mjs --fix   # validate structure, compute promotion status
```

| Path | What it is |
|---|---|
| `schema.json` | the case contract |
| `templates/case-template.json` | skeleton with every field explained |
| `build-corpus.mjs` | one-shot assembler — machine half automatic, human half authored inline |
| `validate.mjs` | the only thing that may promote a case |
| `cases/<ID>/case.json` | a frozen case |

**Cases are frozen once written.** `build-corpus.mjs` skips any case that already exists. An
answer key that moves when the pipeline moves measures nothing.

**Ground truth never comes from a language model.** `validate.mjs` rejects any source that names
one.
