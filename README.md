# Wellbeing companion — working title

An original, local-first wellbeing companion for Hack for Humanity | Summer 2026. The final friendly name will be chosen by the project owner after the product behavior and identity are ready.

## What works now

- polished responsive conversation UI with original warm-plum and light-blue companion variants;
- automatic device-local memory for names, preferences, people, achievements, losses, active projects, user-entered medication schedules, and appointments;
- an honest synthetic-friend relationship frame for people who want companionship, without pretending the companion is biological, demanding exclusivity, or making continued conversation conditional on contacting somebody else;
- natural birthday memory that resolves relative dates against the local calendar, confirms the exact date understood, replaces corrected dates, and offers one annual greeting when the app is opened or used on that date;
- default-on learning with a single Settings switch that pauses new learning without erasing saved memories;
- visible per-memory review and deletion without repetitive permission prompts;
- an optional password-protected AES-256-GCM private vault; it is off by default for people who live alone;
- a cryptographically separate parent/legal-guardian space that cannot read the primary user’s private memories or transcript;
- default-on interest knowledge packs for Miraculous and My Little Pony, including favorite-character memory, series progress, spoiler gating, source links, and a realistic “character values without powers or money” decision lens;
- a remembered reporting-retaliation boundary: reporting may be offered once, a clear refusal suppresses repeated suggestions, and a new specific death threat/weapon/stalking disclosure explains why the risk question has changed;
- an optional real on-device Ollama wording layer for ordinary steady conversation, fixed to the loopback interface and an installed allowlisted model; deterministic safety, medication, diagnosis, bullying, threat, grief, and crisis routes are never delegated;
- a visible per-response receipt that distinguishes local-model wording from the deterministic offline fallback without logging prompt or reply text;
- personalized boredom, low-energy, anger, relationship, and distress conversation paths;
- tentative affect cues that can notice a sustained change from the person's recent communication pattern, ask whether that reading is correct, and back off immediately when corrected; a visible, deletable, bounded receipt stores only turn references and word counts—not a quoted message, emotion label, sentiment score, or diagnosis;
- typed safety contexts for self-harm, acute medical danger, violence risk, external threats, third-party concern, and general distress; the companion keeps talking and makes proportionate urgent options available without locking the chat;
- optional persistent hands-free input: one tap listens, submits a completed utterance, and resumes listening after the visible reply; mute keeps listening active with text-only replies; only the owner-approved calm-female and warm-male product selectors may reach a future reviewed provider, while an unapproved preset fails closed before provider status is queried;
- click-to-play, hash-bound previews of the two owner-approved starter voice samples; these are clearly labeled static previews and never presented as live synthesis;
- idle, listening, speaking, and guided-breathing motion with reduced-motion support;
- adaptive reminder logic that becomes quieter for reliable medication routines and more visible after misses;
- deterministic offline core and unit-testable memory/safety/reminder behavior.

## Important current limits

- encryption is optional and password-based; losing the password means the app cannot decrypt that private space;
- the current curated interest catalog contains only two franchises and does not yet download arbitrary new packs from the internet;
- speech recognition depends on the Windows device and may use a vendor service. This source defines a provider-neutral, local-only voice-output contract and a narrow desktop `status` / `speak` / `cancel` broker, but no synthesis or playback provider is connected or active; spoken output therefore fails closed to visible text and never silently falls back to a browser or operating-system voice;
- without a supported local Ollama model, conversation uses the deterministic fallback; no model download is bundled with this working build;
- conversation behavior is extensively scenario-tested, but the tests are not clinical validation or a valid clinical “Turing test”;
- no clinical validation, diagnosis, prescription, or dose-changing behavior;
- no cloud AI or public health-data transfer is enabled;
- the prior Windows development archive is unsigned and was checksum-sealed and smoke-verified, but the new affect-evidence and approved-selector source changes supersede it; a fresh rebuild, smoke, lifecycle verification, checksum seal, and publisher signature remain required before public release.

## Verification snapshot

The current source snapshot was independently rerun on 2026-08-25 with these reproducible gates:

- source behavior: **396/396 tests passed** across 22 test files (64 reported suites);
- expanded hostile evaluation: **57/57 scenarios passed**, with zero recorded known software defects;
- Windows desktop shell: **51/51 tests passed**;
- TypeScript compilation and the Vite production build: passed;
- both owner-approved static preview WAVs: exact SHA-256 bindings passed;
- desktop JavaScript and PowerShell syntax gates: passed.
- prior sealed Windows setup archive: exact SHA-256 recorded in its matching sidecar and external receipt, now superseded by the source changes above;
- prior packaged-process smoke: window, notification-area tray, renderer, localStorage round trip, and loopback health all passed;
- prior isolated preserve/reinstall/remove-all lifecycle: passed without modifying the real user profile; both package gates must be rerun on the next build.

The reproducible evaluation protocol, fictional corpus, hostile probes, and report generator are in [`evaluation/`](evaluation/). Running the evaluation generator produces the ignored machine report locally. These are software and adversarial scenario tests, not clinical validation. The current package is an unsigned development candidate; its matching sidecar and receipt must travel with it, and the real installer lifecycle still needs a disposable Windows user or VM before public release.

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

Use Node.js 24 and pnpm 11.19.0. Then open the loopback Vite URL shown in the terminal.

For a future native Windows candidate, verify the ZIP against its matching SHA-256 sidecar before accepting an unsigned development build. A final publisher signature is still required for normal public distribution.

## Official rubric trace

See [docs/RESEARCH_AND_SAFETY.md](docs/RESEARCH_AND_SAFETY.md).
