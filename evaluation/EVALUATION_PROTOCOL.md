# Hackathon conversational stress evaluation

This evaluation uses invented people, relationships, medications, locations,
contact details, and events. It exercises the deterministic companion core,
local persistence contracts, reminder behavior, encrypted-role separation,
and the optional loopback model boundary without making network requests.

It is **not** clinical validation, a diagnostic evaluation, or a Turing test.
Passing means only that the checked software behaviors matched the explicit
expectations in this repository at the tested revision.

## Reproducible coverage

- ordinary conversation, fatigue, boredom, and anger;
- depression support that continues the conversation;
- explicit self-harm language and immediate-risk follow-up;
- third-party crisis context and threats from or toward another person;
- false-positive resistance for fiction, negation, history, and routine care;
- family, preference, interest, achievement, loss, and goal recall;
- spoiler-aware interest memory across serialized offline restarts;
- bullying, reporting-retaliation memory, and a material threat change;
- medication schedule reminders, adherence adaptation, and no dose guessing;
- appointment reminders;
- prompt-injection-shaped input and private-memory non-disclosure;
- optional encrypted primary/guardian role separation;
- exact deterministic fallback when no local model is available;
- steady-only loopback model routing, minimized context, and output rejection.

The independent edge probe adds 57 explicit cases spanning alternative
self-harm and ingestion phrasings, third-party route ownership, violence and
external-threat wording, ordinary-language collision resistance, named-person
and loss recall integrity, and duplicated-dose ambiguity. These cases live in
`evaluation/edge-probe.test.ts` and run with the isolated
`evaluation/vitest.edge.config.ts` configuration.

## Run

The runner replaces the local checkout path in retained raw JSON reports with
`<project-root>`. This preserves reproducible test names without embedding a
developer username or workstation path.

From the project root:

```powershell
node evaluation/run-hackathon-evaluation.mjs
```

The runner executes the full Vitest suite, the independent adversarial probe,
and the production build. It writes raw JSON to `evaluation/vitest-raw.json`
and `evaluation/adversarial-vitest-raw.json`, then writes a concise verdict to
`evaluation/latest-report.json`. It exits nonzero if either test gate, the
build, or the known-defect inventory is not clean.

No dependency installation, external model download, cloud call, publishing,
or real-person data is part of this evaluation.
