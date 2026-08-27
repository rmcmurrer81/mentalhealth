# Wellbeing companion — working title

An original, local-first wellbeing companion for Hack for Humanity | Summer 2026. The final friendly name will be chosen by the project owner after the product behavior and identity are ready.

## What works now

- polished responsive conversation UI with original warm-plum and light-blue companion variants rendered as a genuine articulated WebGL 3D character rather than swapped pictures;
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
- named relationship memory that can greet an introduced person, avoid suggesting somebody who is causing the current distress, and offer another remembered person only as a conditional—not compulsory—support option;
- bounded social-event coaching plus a fictional party rehearsal that practices an introduction, small talk, a graceful exit, stop, restart, and return-to-plan; rehearsal identity, preferences, interests, birthdays, medication, and appointments never enter the real profile, while protected safety language interrupts the role-play immediately;
- tentative affect cues that can notice a sustained change from the person's recent communication pattern, ask whether that reading is correct, and back off immediately when corrected; a visible, deletable, bounded receipt stores only turn references and word counts—not a quoted message, emotion label, sentiment score, or diagnosis;
- typed safety contexts for self-harm, acute medical danger, violence risk, external threats, third-party concern, and general distress; the companion keeps talking and makes proportionate urgent options available without locking the chat;
- optional persistent hands-free input: one tap listens, submits a completed utterance, and resumes listening after the visible reply; mute keeps listening active with text-only replies; recognition handlers are detached before an engine is stopped, and every buffered callback is bound to the exact recognition instance, privacy-session epoch, unlocked state, and active hands-free session so old primary speech cannot enter a locked or guardian profile; only the owner-approved calm-female and warm-male product selectors may reach a future reviewed provider, while an unapproved preset fails closed before provider status is queried;
- click-to-play, hash-bound previews of the two owner-approved starter voice samples; these are clearly labeled static previews and never presented as live synthesis;
- mount-once 3D idle, listening, waving, guided-breathing, happy-hop, expression, and preview-viseme motion with reduced-motion support and a clearly labeled procedural 2D fallback only when WebGL is unavailable;
- adaptive reminder logic that becomes quieter for reliable medication routines and more visible after misses;
- deterministic offline core and unit-testable memory/safety/reminder behavior.

## Important current limits

- Hack for Humanity's published rules prohibit development assistance from outside
  the registered team. Because this candidate was developed with AI coding assistance
  and the organizers have not published an AI-assistant clarification, written
  organizer confirmation is required before representing it as an eligible entry;
- encryption is optional and password-based; losing the password means the app cannot decrypt that private space;
- the current curated interest catalog contains only two franchises and does not yet download arbitrary new packs from the internet;
- speech recognition depends on the Windows device and may use a vendor service. Candidate 0.2.12 keeps the bounded, optional offline Chatterbox output route behind the narrow desktop `status` / `speak` / `cancel` broker and queues a complete visible reply while the local voice warms instead of silently losing it. On the development computer, a generic synthetic female probe loaded the existing user cache without a download and confirmed audible playback. The roughly 3.2 GB model cache, Python 3.14 environment, and CUDA runtime are **not bundled** in the installer, so other computers truthfully remain text-only unless those reviewed local dependencies already exist. There is no silent browser, Windows, or named-person voice fallback;
- without a supported local Ollama model, conversation uses the deterministic fallback; no model download is bundled with this working build;
- conversation behavior is extensively scenario-tested, but the tests are not clinical validation or a valid clinical “Turing test”;
- no clinical validation, diagnosis, prescription, or dose-changing behavior;
- no cloud language-model integration or public-model transfer is enabled; optional hands-free recognition retains the browser/operating-system service boundary described above;
- Windows candidate 0.2.12 supersedes 0.2.11 while preserving its compact character-first presentation. The complete compact transcript has a bounded scroll area, renders every saved turn without line clamping, follows the newest reply, uses a 14px conversation size, and applies a 12px floor to user-facing microcopy. The fresh onboarding question is spoken after the optional authenticated-loopback Chatterbox host becomes ready, and a reply submitted during voice warmup is queued rather than dropped. Installed Apps and the Start-menu route now open a normal Windows uninstall choice, close only the exact installed companion executable, preserve private data by default, and keep remove-all explicit. The small pin control can release always-on-top at any time; full mode is not pinned. It retains the disclosed Electron child-process compatibility boundary only on Windows builds 26200-26399: GPU and renderer process sandboxes are disabled while context isolation stays enabled, Node integration and webviews stay disabled, navigation stays fixed to `127.0.0.1`, and external renderer requests stay blocked. It remains unsigned and on OWNER-TEST CANDIDATE HOLD. Use only the matching external SHA-256 sidecar and current verification record. Its extracted root contains a double-click setup EXE; receipt-bound PowerShell support files are kept beneath `Support`, and no `.ps1` appears at the setup root. Temporary-root lifecycle tests do not execute the real installer or mutate a real Windows profile; owner testing of the exact installed package—including voice discovery, playback, mute, and the normal uninstall UI—in a disposable Windows user or virtual machine, explicit review of the build-26200 compatibility tradeoff, and publisher signing remain required before public release.

## Verification snapshot

The current candidate source snapshot was rerun on 2026-08-27 with these reproducible gates:

- current source behavior: **1,663/1,663 tests passed** across 32 test files, including all prior memory-generation/privacy-session, hands-free, accessibility/privacy-wording, compact-window, theme, and focused 3D/production-distribution checks plus full compact-transcript visibility, auto-scroll, readable type, queued voice warmup, and fresh-onboarding speech regression coverage. Regressions keep birthday clauses out of person memories, reflect first-person relationship details from the user's perspective, respect a recent request for space when contact advice is requested, and require the built-in 60-second reset to provide its actual breathing guidance. A structured actor/evidence/frame/action-sense/object/quantity ingestion graph is exercised by generated direct-speech, witness, passive, preposed-object, intent, negation, counterfactual, remote-history, routine-use, transport/media/task/food, and prescriber-comparison matrices. Regressions also verify acute precedence, no memory or care-plan persistence during urgent or unresolved ingestion turns, sentence-bounded prescriber/label schedules, Unicode relationship names, factuality and question guards, atomic achievement/interest learning, punctuation cleanup, relationship identity separated from transient events, natural-language birthday-age capture and correction, full appointment-provider names, general part-of-day medication schedules without invented clock times, and an urgent-options quick action that opens the existing disclosure panel without posting a chat turn;
- expanded hostile evaluation: **57/57 scenarios passed**. The known-defects register is not treated as proof of completeness; release blockers remain explicit below;
- Windows desktop shell and installer: **69/69 tests passed**, including compact and character-only native-window bounds and default always-on-top policy, exact local-voice host handshake boundaries, normal hidden-console uninstall routing, exact-path app shutdown, a retry-window regression for the prior fixed-loopback startup race, and explicit exhausted-retry evidence;
- TypeScript compilation and the Vite production build: passed;
- both owner-approved static preview WAVs: exact SHA-256 bindings passed;
- desktop JavaScript and PowerShell syntax gates: passed.
- current 0.2.12 owner-review archive: verify its exact bytes and SHA-256 against the generated external sidecar and current external verification record; Authenticode remains `NotSigned` unless a publisher-signed runtime is supplied;
- formal recheck status: **automated software, exact packaged process, and isolated lifecycle must pass; owner installation/visual acceptance and hackathon eligibility remain HOLD**;
- package-process verification additionally requires the exact extracted executable to prove its distinct native title and icon, notification-area tray, fixed-loopback renderer, localStorage round trip, genuine WebGL 3D motion and wave, the disclosed Windows child-process compatibility state, fail-closed local voice during smoke with no system-voice fallback, and microphone-denial recovery to a completed typed deterministic reply. Separate package-integrity checks bind the Chatterbox adapter, Python host, and reviewed synthetic references while proving that model weights are not bundled;
- the current post-build verification evidence records the final exact-package run set and its 3/3 separate launches. Package verification also proves the root double-click launcher layout, PowerShell beneath `Support`, no root `.ps1`, receipt-only verification without profile mutation, and receipt-tamper rejection;
- isolated preserve/reinstall/remove-all lifecycle is exercised without modifying the real user profile or executing the real installer. Earlier archives and evidence remain available only as historical records.

The reproducible evaluation protocol, fictional corpus, hostile probes, and report generator are in [`evaluation/`](evaluation/). Running the evaluation generator produces the machine report locally. These are software and adversarial scenario tests, not clinical validation. The sanitized current evidence is in [`docs/CURRENT_VERIFICATION_EVIDENCE.md`](docs/CURRENT_VERIFICATION_EVIDENCE.md). Candidate 0.2.12 is unsigned; its automated lifecycle receipt is a temporary-root harness rather than a real-profile installer run.

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
