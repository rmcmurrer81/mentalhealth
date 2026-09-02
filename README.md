# Wellbeing companion — working title

An original, local-first wellbeing companion for Hack for Humanity | Summer 2026. The final friendly name will be chosen by the project owner after the product behavior and identity are ready.

## What works now

- polished responsive conversation UI with one stable temporary animated orb, including listening, thinking, speaking, playback-energy, and reduced-motion states; this is truthfully described as procedural interface animation, not a true 3D mesh or skeletal character;
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
- optional persistent hands-free input: in the installed Windows app, one tap opens bounded `MediaRecorder` capture only after explicit app-session approval and any Windows device permission, transcribes through an authenticated loopback cache-only `faster-whisper-small.en` host, discards the in-memory audio after the turn, submits the completed utterance, and resumes after the visible reply; mute keeps listening active with text-only replies, while hide, lock, role change, stop, and teardown stop every track and invalidate buffered callbacks;
- click-to-play, hash-bound previews of the two owner-approved starter voice samples; these are clearly labeled static previews and never presented as live synthesis;
- mount-once temporary orb renderer with live listening/thinking/speaking state, bounded orbital motion, reduced-motion styling, and output-only playback timing that never exposes conversation text, raw audio, or generated-audio paths to the renderer;
- adaptive reminder logic that becomes quieter for reliable medication routines and more visible after misses;
- deterministic offline core and unit-testable memory/safety/reminder behavior.

## Important current limits

- Hack for Humanity's published rules prohibit development assistance from outside
  the registered team. Because this candidate was developed with AI coding assistance
  and the organizers have not published an AI-assistant clarification, written
  organizer confirmation is required before representing it as an eligible entry;
- encryption is optional and password-based; losing the password means the app cannot decrypt that private space;
- the current curated interest catalog contains only two franchises and does not yet download arbitrary new packs from the internet;
- candidate 0.2.25 keeps Chatterbox output behind the narrow desktop `status` / `speak` / `cancel` broker, does not mark speaking until the host reports actual device-playback timing, and cancels active generation/playback immediately when muted. Installed speech input uses a separate bounded cache-only local recognizer. Exact-package probes verified the personalized welcome and local voice/speech boundaries while complete text stayed visible. The Chatterbox cache, `faster-whisper-small.en` cache, Python packages, and required local compute runtimes are **not bundled**, so another computer truthfully remains text-only unless those reviewed dependencies already exist. There is no silent browser, Windows, or named-person output-voice fallback;
- without a supported local Ollama model, conversation uses the deterministic fallback; no model download is bundled with this working build;
- conversation behavior is extensively scenario-tested, but the tests are not clinical validation or a valid clinical “Turing test”;
- no clinical validation, diagnosis, prescription, or dose-changing behavior;
- no cloud language-model integration or public-model transfer is enabled; the installed hands-free route is cache-only and local, while the browser-only development view may still fall back to the browser recognition capability;
- Windows candidate 0.2.25 is the current owner-test archive and preserves a compact character-first presentation around a temporary animated orb. Full assistant replies remain readable and scroll from the start of the newest turn. First run collects preferred name, soft-female or warm-male voice, light/default-medium/dark theme, and an explicit microphone choice before the main conversation. Fresh or legacy profiles without a saved speech marker default spoken replies on, while an explicit mute choice persists. When audio is enabled, setup stays on a truthful local-voice warm-up screen until the personalized welcome actually begins playback; the only fallback is an explicit text-only choice. The normal setup executable uses meaningful welcome/review/real-progress/finish pages with no custom unsigned-warning or completion popups and no artificial delay. The package remains unsigned and on OWNER-TEST CANDIDATE HOLD: Windows Smart App Control or reputation warnings may still appear, publisher signing remains required, and no code claims it can silently grant Windows microphone consent. Owner testing of the exact installed package—including setup pacing, first-run choices, spoken welcome, hands-free input, mute, animation, full text, and normal uninstall—in a disposable Windows user or VM remains required before normal public binary distribution.

## Verification snapshot

The current candidate source snapshot was rerun on 2026-09-01 with these reproducible gates:

- current source behavior: **1,733/1,733 tests passed** across 41 test files, including safety, memory, privacy-session, accessibility, compact-window, theme, first-run completion, full reply readability, default-on speech with persisted explicit mute, current orb motion, conversational continuity, and installed cache-only speech-input wiring;
- expanded hostile evaluation: **57/57 scenarios passed**. The known-defects register is not treated as proof of completeness; release blockers remain explicit below;
- Windows desktop shell and installer: **81/81 tests passed**, including compact and character-only native-window bounds, exact-package first-run voice integration, output-only playback timing validation, playing-phase mute cancellation, cache-only speech-input boundaries, current embedded-package metadata, the meaningful no-popup setup wizard, exact-path app shutdown, and the fixed-loopback startup retry boundary;
- TypeScript compilation and the Vite production build: passed;
- both owner-approved static preview WAVs: exact SHA-256 bindings passed;
- desktop JavaScript and PowerShell syntax gates: passed.
- candidate 0.2.25 owner-review archive: `desktop-shell/release/Wellbeing-Companion-Working-Title-Setup-0.2.25-win32-x64.zip`, 151,064,373 bytes, SHA-256 `B8BD41EC9BFEDE4C639EB8189E35215C43819950EDAE0FD740FE7E3387E9F230`. The build verifies that the renamed runtime host is byte-for-byte identical to `electron.exe` from the pinned official Electron 43.4.1 archive and applies no executable resource mutation. That exact upstream host is itself Authenticode `NotSigned`, so preserving it cannot create a Microsoft/Electron trust chain. An optional publisher runtime is accepted only when both its exact SHA-256 and signer-certificate thumbprint are supplied and verified;
- formal recheck status: **automated software, exact packaged process, and isolated lifecycle must pass; owner installation/visual acceptance and hackathon eligibility remain HOLD**;
- package-process verification additionally requires the exact extracted executable to prove its distinct native title/icon, tray, fixed-loopback renderer, localStorage round trip, temporary-orb renderer and advancing motion, disclosed Windows child-process compatibility state, fail-closed smoke voice, and microphone-denial recovery to a completed typed deterministic reply. Separate exact-package probes bind real Chatterbox playback timing and playing-phase mute cancellation plus fixed-synthetic local transcription without retaining transcript text or raw audio in receipts;
- the current post-build verification evidence records the final exact-package run set and its 3/3 separate launches. Package verification also proves the root double-click launcher layout, PowerShell beneath `Support`, no root `.ps1`, receipt-only verification without profile mutation, and receipt-tamper rejection;
- isolated preserve/reinstall/remove-all lifecycle is exercised without modifying the real user profile or executing the real installer. Earlier archives and evidence remain available only as historical records.

The reproducible evaluation protocol, fictional corpus, hostile probes, and report generator are in [`evaluation/`](evaluation/). Running the evaluation generator produces the machine report locally. These are software and adversarial scenario tests, not clinical validation. The sanitized current evidence is in [`docs/CURRENT_VERIFICATION_EVIDENCE.md`](docs/CURRENT_VERIFICATION_EVIDENCE.md). Candidate 0.2.25 is unsigned; its automated lifecycle receipt is a temporary-root harness rather than a real-profile installer run.

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

Use Node.js 24 and pnpm 11.19.0. Then open the loopback Vite URL shown in the terminal.

For a future native Windows candidate, verify the ZIP against its matching SHA-256 sidecar before accepting an unsigned development build. A final publisher signature is still required for normal direct distribution. A Microsoft Store MSIX route can obtain Microsoft package signing after certification, but it requires owner-controlled Partner Center identity verification, a reserved final product identity, Store manifest values, submission assets, and certification; no local build may claim that trust before those external steps complete.

## Official rubric trace

See [docs/RESEARCH_AND_SAFETY.md](docs/RESEARCH_AND_SAFETY.md).
