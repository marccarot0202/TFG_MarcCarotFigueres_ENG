# Evaluation

Reproducible harness and recorded evidence for the risk classifier.

## Reported run

Eight classifiable cases (A1, B1, B2, C1, C2, D1, D2, E1), ten observations
each: **80 observations** of the deterministic engine.

| Metric | Result |
|--------|--------|
| Accuracy | 91.25 % |
| Precision | 100 % |
| Recall | 81.08 % |
| Specificity | 100 % |
| F1 | 89.55 % |

Confusion matrix: 30 true positives, 43 true negatives, 0 false positives,
7 false negatives.

The seven false negatives all come from case C2. The decoder only flags an
approval as unlimited when the amount is exactly `MaxUint256`, so amounts that
are slightly lower — but still above 2^255 — keep a `LOW` verdict. This bounds
the current rule coverage and is the first item of future work.

## Reproducing it

```bash
cd backend
npm install
npm run evaluation:matrix
```

Results are written to `evaluation-matrix.json` and `evaluation-matrix.csv`.

## Provenance of the recorded evidence

`results/` and `evidence/` contain material captured on 17-18 July 2026 from the
**original run of the system**, whose interface and generated text were in
Catalan and Spanish. Those records are kept exactly as produced: they are
experimental evidence, and rewriting recorded output would misrepresent what the
system actually returned.

Consequently, in those files you will find the original verdict codes
(`BAJO`, `MEDIO`, `ALTO`, `DESCONOCIDO`) rather than the English codes
(`LOW`, `MEDIUM`, `HIGH`, `UNKNOWN`) used by this edition of the code. The
classification logic, the scores and the thresholds are identical; only the
output language and the code labels differ.

Re-running the harness on this edition regenerates the same figures with English
labels and text.
