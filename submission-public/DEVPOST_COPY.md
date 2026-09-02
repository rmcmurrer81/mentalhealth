# Here With You — Local Wellbeing Companion

> **Draft — do not submit until every HOLD below is resolved.**
>
> Owner display name: **[CONFIRM OWNER DISPLAY NAME]**
>
> GitHub: https://github.com/rmcmurrer81/mentalhealth
>
> Try it out: **[NO VERIFIED HOSTED OR DOWNLOAD URL YET]**
>
> Demo video: **[ADD FINAL VIDEO URL]**

## Project overview

**Project name:** Here With You — Local Wellbeing Companion

**Elevator pitch:**
A local-first wellbeing companion that remembers what matters, supports everyday and difficult moments, and keeps high-risk responses inside a tested deterministic safety boundary.

**Primary category recommendation:** Mental Health

## Inspiration

Support is often needed in the ordinary minutes between appointments: after a hard
day, while preparing for a stressful event, or when someone simply wants a calm place
to think. Many tools either forget the context that makes a person unique or send
sensitive conversation to a remote service.

Here With You explores a different approach: a transparent synthetic companion that can
remember user-chosen details on the device, keep everyday conversation useful, and
route high-risk situations through deterministic, testable rules instead of optional
generative wording.

## What it does

Here With You is a local-first wellbeing companion for Windows and the web. It provides:

- contextual conversation for everyday stress, boredom, grief, loneliness, anger,
  school or work pressure, and nervousness about social events;
- device-local memory for user-provided names, preferences, relationships, goals,
  achievements, losses, appointments, birthdays, and medication schedules;
- visible memory review, individual deletion, and a switch that pauses new learning
  without silently erasing existing memories;
- reminders, low-pressure activities, offline text games, and a bounded fictional
  social-event rehearsal;
- tentative interaction-pattern cues that are presented as uncertain, accept
  correction, do not store an inferred emotion, and never outrank a safety route;
- distinct deterministic routes for self-harm, acute medical danger, violence risk,
  external threats, third-party concern, grief, medication uncertainty, and diagnosis
  requests;
- an optional password vault using PBKDF2-SHA-256 and AES-256-GCM, plus a
  cryptographically separate parent or legal-guardian space;
- optional local Ollama wording for ordinary steady conversation only;
- optional local Chatterbox speech output and cache-only faster-whisper input when
  the reviewed dependencies already exist on the device;
- complete visible text and fail-closed behavior when optional local speech or model
  dependencies are unavailable.

The current visual companion is an animated orb. It is not presented as true 3D, a
human, a therapist, or a clinician.

## How we built it

The interface uses React, TypeScript, and Vite, with a PWA manifest and service worker.
The native Windows shell uses Electron and serves the bundled web app from a fixed
loopback origin. The deterministic conversation core owns protected safety,
medication, diagnosis, grief, bullying, and threat routes. An optional allowlisted
Ollama model can improve wording only for ordinary steady replies and cannot redirect
those protected routes.

Normal profile data stays in the device-local application profile. The optional vault
derives a key with PBKDF2-SHA-256 and seals data with AES-256-GCM. Local speech input
and output use authenticated, bounded loopback brokers and do not silently fall back
to a browser, operating-system, cloud, or named-person voice.

The project uses deterministic unit tests, synthetic conversational benchmarks,
hostile safety scenarios, desktop permission tests, and package verification. These
are engineering results, not clinical validation.

## Challenges

### Specific support without scripted repetition

The companion needed to respond to what the user actually said, continue context
across turns, and offer a small number of relevant choices without parroting the
message or repeating generic crisis language.

### Useful memory without surveillance

Memory had to be reviewable and deletable, respect corrections and boundaries, keep
fiction and rehearsals out of the real profile, and prevent stale model output from
reintroducing something the user had just forgotten.

### A narrow AI boundary

Optional local generation is useful for tone, but it cannot own medication, diagnosis,
self-harm, violence, acute medical, grief, bullying, or external-threat behavior.
Those routes remain deterministic and explainable.

### Honest offline voice and packaging

Heavy speech models and GPU dependencies are not bundled. The app therefore has to
report readiness truthfully, keep the full text visible, cancel across privacy and
lifecycle changes, and remain usable when voice is unavailable.

## Accomplishments

- A fresh September 1 source run passed **1,733/1,733 tests across 41 test files**.
- The current TypeScript and Vite production build passed.
- The current synthetic conversation-quality report records **280/280 checks** across
  17 categories. It uses synthetic data and is not clinical evaluation.
- The 0.2.25 candidate record binds an exact unsigned owner-test archive and documents
  source, package, voice, speech, onboarding, startup-smoke, and isolated-lifecycle
  evidence.
- The product remains useful as typed local software when optional Ollama, Chatterbox,
  or faster-whisper dependencies are absent.

Before submission, rerun the full desktop suite after closing the installed app. The
September 1 audit passed 80 tests and had one environmental failure because that
running app already owned the test loopback port; this packet does not turn that run
into an 81/81 claim.

## What we learned

Responsible AI is an architecture, not a warning label. The most important choices
were deciding what an optional model is never allowed to control, what the product
must refuse to infer, what memory must be easy to remove, and how the app behaves when
local dependencies are unavailable.

Privacy and accessibility also work best as visible product behavior: local storage,
optional encryption, separate roles, complete text, mute, reduced motion, keyboard
operation, and honest status messages make the companion more understandable and
more useful.

## What's next

- written organizer eligibility confirmation for the disclosed AI-assisted workflow;
- final owner-approved branding;
- owner usability and real installer testing in a disposable Windows account or VM;
- independent accessibility review and evaluation with clinicians and people with
  lived experience;
- a production-quality true 3D character, if it can meet the accessibility and
  performance gates;
- a publisher-signed public Windows build;
- final native screenshots, captions, a reviewed four-minute demo, and a verified
  judge download or hosted URL.

## Built with

React 19.2.8, React DOM 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Electron 43.4.1,
Node.js 24, pnpm 11.19.0, Vitest 4.1.11, Web Crypto API, PBKDF2-SHA-256,
AES-256-GCM, optional loopback-only Ollama, optional local Chatterbox, optional
cache-only faster-whisper, PowerShell, Windows installer tooling, and PWA
manifest/service-worker support.

## Try it out

- Source: https://github.com/rmcmurrer81/mentalhealth
- Hosted or downloadable demo: **None verified yet**
- Video: **Not uploaded yet**

Local source instructions:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

Use Node.js 24 and pnpm 11.19.0.

## Submission truth boundary

Here With You is not a clinician, emergency service, diagnostic tool, treatment, or
replacement for professional care. Do not claim clinical effectiveness, diagnosis,
prescribing, dose changes, emotion recognition, guaranteed speech, blanket
encryption, a signed installer, a live hosted demo, or true 3D. Obtain organizer
eligibility confirmation before submitting.
