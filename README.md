# Wellbeing companion — working title

An original, local-first wellbeing companion for Hack for Humanity | Summer 2026. The final friendly name will be chosen by the project owner after the product behavior and identity are ready.

## What works now

- polished responsive conversation UI with original warm-plum and light-blue companion variants;
- automatic device-local memory for names, preferences, people, achievements, losses, active projects, user-entered medication schedules, and appointments;
- an honest synthetic-friend relationship frame for people who want companionship, without pretending the companion is biological, demanding exclusivity, or making continued conversation conditional on contacting somebody else;
- natural birthday memory that resolves relative dates against the local calendar, confirms the exact date understood, replaces corrected dates, and offers one annual greeting when the app is opened or used on that date;
- default-on learning with a single Settings switch that pauses new learning without erasing saved memories;
- visible per-memory review and deletion without repetitive permission prompts; forgetting a memory also removes transcript turns that created, quoted, or directly used that memory while retaining unrelated conversation, including unrelated turns that merely share a person's given name;
- a memory-generation guard that detects Forget during a pending local-model reply, discards the stale result, and recomputes from the post-forget profile before any reply is shown or saved;
- a separate privacy-session epoch that quiesces hands-free output and invalidates an entire pending send across lock, unlock, same-profile relock, guardian-role replacement, or vault creation; vault sealing blocks conversation, Forget, and profile-setting mutation until the exact captured profile is encrypted, so stale transcript, memory, and care-plan data cannot cross private spaces;
- an optional password-protected AES-256-GCM private vault; it is off by default for people who live alone;
- a cryptographically separate parent/legal-guardian space that cannot read the primary user’s private memories or transcript;
- default-on interest knowledge packs for Miraculous and My Little Pony, including favorite-character memory, series progress, spoiler gating, source links, and a realistic “character values without powers or money” decision lens;
- a remembered reporting-retaliation boundary: reporting may be offered once, a clear refusal suppresses repeated suggestions, and a new specific death threat/weapon/stalking disclosure explains why the risk question has changed;
- an optional real on-device Ollama wording layer for ordinary steady conversation, fixed to the loopback interface and an installed allowlisted model; deterministic safety, medication, diagnosis, bullying, threat, grief, and crisis routes are never delegated;
- a visible per-response receipt that distinguishes local-model wording from the deterministic offline fallback without logging prompt or reply text;
- personalized boredom, low-energy, anger, relationship, and distress conversation paths;
- tentative affect cues that can notice a sustained change from the person's recent communication pattern, ask whether that reading is correct, and back off immediately when corrected; a visible, deletable, bounded receipt stores only turn references and word counts—not a quoted message, emotion label, sentiment score, or diagnosis;
- typed safety contexts for self-harm, acute medical danger, violence risk, external threats, third-party concern, and general distress; the companion keeps talking and makes proportionate urgent options available without locking the chat;
- optional persistent hands-free input: one tap listens, submits a completed utterance, and resumes listening after the visible reply; mute keeps listening active with text-only replies; recognition handlers are detached before an engine is stopped, and every buffered callback is bound to the exact recognition instance, privacy-session epoch, unlocked state, and active hands-free session so old primary speech cannot enter a locked or guardian profile; only the owner-approved calm-female and warm-male product selectors may reach a future reviewed provider, while an unapproved preset fails closed before provider status is queried;
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
- no cloud language-model integration or public-model transfer is enabled; optional hands-free recognition retains the browser/operating-system service boundary described above;
- the current Windows development archive contains this 433-test accessibility/privacy revision, is checksum-sealed, and passed three packaged-process smokes; it remains unsigned, and its isolated lifecycle harness did not execute the real installer or mutate a real Windows profile. Owner testing in a disposable Windows user or virtual machine and publisher signing remain required before public release.

## Verification snapshot

The current source snapshot was independently rerun on 2026-08-25 with these reproducible gates:

- current packaged source behavior: **433/433 tests passed** across 25 test files (70 reported suites), including all **11/11 memory-generation/privacy-session regression tests**, **5/5 hands-free control tests**, and **3/3 drawer-accessibility/privacy-wording tests**; the hands-free group includes two genuine buffered interim/final callback interleavings after lock and guardian unlock, while the memory suite covers Nina Simone collision preservation, ordinary Forget during a delayed local-model reply, relock invalidation, vault-creation mutation blocking, and app-level quiescence wiring;
- expanded hostile evaluation: **57/57 scenarios passed**; the machine-readable known-defects register contains **0 open entries for this tested source snapshot**, which is not a claim that the software can have no defects;
- Windows desktop shell: **51/51 tests passed**;
- TypeScript compilation and the Vite production build: passed;
- both owner-approved static preview WAVs: exact SHA-256 bindings passed;
- desktop JavaScript and PowerShell syntax gates: passed.
- current 433-test Windows setup archive: exact size and SHA-256 are recorded in its matching external sidecar, package receipt, and sanitized verification evidence; Authenticode `NotSigned`; three consecutive packaged-process smokes passed;
- packaged-process smoke: window, notification-area tray, renderer, localStorage round trip, and loopback health all passed;
- isolated preserve/reinstall/remove-all lifecycle: passed without modifying the real user profile; it used the exact sealed payload but did not execute the real installer.

The reproducible evaluation protocol, fictional corpus, hostile probes, and report generator are in [`evaluation/`](evaluation/). Running the evaluation generator produces the ignored machine report locally. These are software and adversarial scenario tests, not clinical validation. The sanitized current evidence is in [`docs/CURRENT_VERIFICATION_EVIDENCE.md`](docs/CURRENT_VERIFICATION_EVIDENCE.md). The current sealed archive contains the 433-test accessibility/privacy-language revision. It is unsigned, and its lifecycle receipt is a temporary-root harness rather than a real-profile installer run.

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
