# Conversation quality benchmark — current deterministic responses

Benchmark version: 1.1.0

This is a deterministic software-quality probe using invented scenarios. It is not clinical validation, a diagnosis evaluation, or evidence of real-world outcomes. It performs no network calls and does not change the response implementation.

## Result

- Categories: 17
- Cases / turns: 52 / 57
- Checks passed: 280 / 280
- Diagnostic score: 100%
- Failed checks: 0

A failed check is a concrete response-quality gap, not proof of harm. The benchmark intentionally remains diagnostic rather than silently lowering expectations until every case passes.

## Scores by metric

| Metric | Passed | Checks | Score |
|---|---:|---:|---:|
| specificity | 56 | 56 | 100% |
| empathy-without-parroting | 43 | 43 | 100% |
| actionable-options | 56 | 56 | 100% |
| contextual-memory | 4 | 4 | 100% |
| calibrated-questions | 51 | 51 | 100% |
| non-repetition | 5 | 5 | 100% |
| safety-escalation | 57 | 57 | 100% |
| refusal-limits | 8 | 8 | 100% |

## Scores by situation

| Situation | Cases | Passed | Checks | Score |
|---|---:|---:|---:|---:|
| loneliness | 3 | 16 | 16 | 100% |
| social-anxiety-event-attendance | 3 | 15 | 15 | 100% |
| grief | 3 | 16 | 16 | 100% |
| conflict | 4 | 30 | 30 | 100% |
| work-school-stress | 3 | 15 | 15 | 100% |
| financial-stress | 3 | 15 | 15 | 100% |
| relationship-issues | 3 | 16 | 16 | 100% |
| caregiving | 3 | 17 | 17 | 100% |
| disability-accessibility | 3 | 15 | 15 | 100% |
| identity-culture | 3 | 15 | 15 | 100% |
| ambiguous-intent | 3 | 15 | 15 | 100% |
| escalating-crisis | 3 | 26 | 26 | 100% |
| abuse-coercion | 3 | 14 | 14 | 100% |
| substance-use | 3 | 14 | 14 | 100% |
| medical-uncertainty | 3 | 13 | 13 | 100% |
| hallucination-delusion-sensitivity | 3 | 16 | 16 | 100% |
| everyday-non-mental-health | 3 | 12 | 12 | 100% |

## Exact failed checks

The JSON companion report retains the complete structured result for every turn. Each row below is one exact failed rule; a turn can fail more than one rule.

| Case / turn | Situation | Metric | Failure | Actual route | Input | Response |
|---|---|---|---|---|---|---|

## Interpretation boundary

Passing means only that the current deterministic output matched the explicit lexical, routing, memory, question-count, action, repetition, and limit checks in this benchmark. Human review, accessibility review, cultural review, clinical safety review, and owner testing remain necessary.
