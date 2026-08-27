# Hack for Humanity 2026 judging alignment

Date reviewed: 2026-08-26  
Submission deadline: 2026-09-04 at 11:45 PM EDT  
Project state: owner-test candidate in development; not submission-approved

Official pages:

- https://hack-for-humanity-summer-26.devpost.com/
- https://hack-for-humanity-summer-26.devpost.com/rules
- https://hack-humanity.web.app/Health%20Judging%20Guide.pdf
- https://hack-humanity.web.app/AI-ML%20Judging%20Guide.pdf
- https://hack-humanity.web.app/Design%20and%20Innovation%20Judging%20Guide.pdf

## Required submission

The official page requires functioning source code in a GitHub repository and
a video no longer than four minutes. The video must explain the problem, show
the software and its functionality in detail, and give an overview of how it
was created.

## Eligibility hold

The rules say development may only begin after the event opened and that a
participant may not receive development assistance from people outside the
registered group. Before submission, the organizer must clarify in writing
whether the development process and tools used for this project are eligible
under that rule. Until then, the project must not be represented as eligible.

## Evidence against the judging guides

### Domain effectiveness

Current evidence:

- remembers people, interests, milestones, appointments, and the person's
  stated prescribed-medication schedule locally;
- supports corrections instead of retaining conflicting birthday ages;
- offers calm conversation, role-play, grounding, and offline games;
- continues the conversation during distress and keeps urgent options
  available without replacing the conversation;
- avoids diagnosis, prescribing, and treatment changes.

Remaining gap:

- this is not a clinically validated product and must not claim clinical
  effectiveness;
- owner testing and independent domain review are still required.

### Feasibility and safety

Current evidence:

- deterministic high-risk routing and adversarial scenario tests;
- explicit medication provenance and no invented prescribed clock time;
- local-first storage, deletion controls, optional privacy password, and no
  required cloud account;
- urgent support remains optional and visible while the conversation stays
  open;
- microphone access requires a deliberate hands-free action and text remains
  available after denial.

Remaining gap:

- real-world clinical deployment readiness is not proven;
- live microphone behavior, generated voice, and long-duration owner use are
  not yet accepted.

### Technical complexity and responsible AI

Current evidence:

- deterministic offline conversation and safety core;
- optional local-model boundary rather than a required public API;
- explainable memory records and bounded check-in receipts;
- hostile-input, longitudinal-memory, package, and local-runtime tests;
- source contains a procedural articulated WebGL character rather than a set
  of character pictures.

Remaining gap:

- the approved local generated-voice provider is not connected;
- the current visemes are a bounded animation preview, not audio-timed lip
  sync;
- no custom model fine-tuning or clinical dataset claim is permitted.

### Innovation, UI/UX, and accessibility

Current evidence:

- a visually distinct synthetic companion with local continuity instead of a
  generic chat page;
- separate Talk, Play, Memory, and Settings surfaces;
- keyboard-accessible controls, focus management, reduced-motion behavior,
  visible text for every reply, and explicit non-3D fallback labeling;
- procedural 3D expressions, wave movement, a joy hop, and several mouth
  shapes.

Remaining gap:

- the product still needs an owner-approved name;
- generated voice, audio-timed lip sync, language packs, and full owner
  installer testing remain held;
- accessibility automation is evidence, not a substitute for human testing.

## Video priorities if eligibility is confirmed

1. Open the independent desktop app and introduce a fictional person.
2. Show memory across a restart: name, interests, family relationship,
   corrected birthday, appointment, and medication schedule.
3. Show an everyday conversation and one role-play or offline game.
4. Show a distress conversation that continues while optional urgent choices
   remain available.
5. Show local/offline behavior, memory controls, the procedural 3D companion,
   and the exact limitations.

Do not claim generated voice, audio-synchronized lips, clinical validation,
eligibility, public availability, or a signed installer until each has its own
evidence and approval.
