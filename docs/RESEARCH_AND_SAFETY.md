# Research and safety basis — working title

This project is a clean-room build begun during Hack for Humanity | Summer 2026. It is not a copy of Kira World or any prior health product.

## Official judging targets

- [Hackathon overview](https://hack-for-humanity-summer-26.devpost.com/) — software that improves mental or physical wellbeing; functioning GitHub source and a video of no more than four minutes; submission deadline **September 4, 2026 at 11:45 PM EDT**.
- [Official rules](https://hack-for-humanity-summer-26.devpost.com/rules) — development after the opening date, owned/accessible attributed assets, up to four participants, and required software/video submission.
- [Health judging guide](https://hack-humanity.web.app/Health%20Judging%20Guide.pdf) — domain effectiveness plus feasibility and safety.
- [AI/ML judging guide](https://hack-humanity.web.app/AI-ML%20Judging%20Guide.pdf) — technical complexity plus privacy, validation, guardrails, leakage prevention, adversarial defense, and explainability.
- [Design and innovation guide](https://hack-humanity.web.app/Design%20and%20Innovation%20Judging%20Guide.pdf) — novelty, seamless UX, focus states, screen-reader compatibility, and broad accessibility.

## Product boundary

The companion supports conversation, reflection, routines, user-entered medication schedules, and appointment organization. It does not diagnose conditions, prescribe medication, change dosages, make clinical decisions, or guarantee the behavior of emergency or crisis services.

The conversation never shuts down merely because distress or self-harm language appears. A typed safety layer separates self-harm, acute medical danger, violence risk, external threats, third-party concern, and general distress so one context cannot silently leak into another. It instead:

1. keeps talking in ordinary language;
2. asks a short direct question about immediate danger when explicit self-harm intent appears;
3. suggests immediate environmental safety steps without presenting them as commands;
4. keeps “continue talking here” visible;
5. offers outside support as a choice in a quiet corner rather than replacing the chat;
6. directs to emergency services or Poison Help when immediate danger, injury, overdose, or poisoning is disclosed;
7. time-bounds urgent context and preserves a clear reason trail so later ordinary conversation does not inherit a stale emergency state.

## Privacy model

Without a privacy password, the prototype stores profile data only in the app's device-local profile and explicitly labels that state as local memory. A user in a shared home can enable an optional password vault. The implementation uses PBKDF2-SHA-256 (310,000 iterations with a random 128-bit salt) and AES-256-GCM with a new 96-bit IV for every seal; the primary and guardian roles are bound as authenticated additional data. The password is never stored. Wrong passwords, ciphertext modification, or role relabeling fail closed.

The parent/legal-guardian space is a separate encrypted profile. It cannot decrypt or display the primary user’s transcript or memories. This separation is intentional: a guardian can have their own conversation without turning the child’s private journal into a surveillance feed.

No raw health memory is sent to a public model API in this prototype. The optional AI wording layer calls only an allowlisted model already installed in local Ollama through the fixed loopback address `127.0.0.1`. It is restricted to ordinary steady conversation. Deterministic protected routes handle medication uncertainty, diagnosis requests, acute medical danger, self-harm, violence risk, threats, bullying, grief, and third-party concern. The model candidate is schema-validated, provenance-labeled, rejected on policy mismatch, and never receives safety-route work. Prompts and replies are not logged. Future online intelligence must use explicit per-provider consent, data minimization, redaction, no-training terms where available, and a visible activity receipt.

Memory extraction also distinguishes lived facts from fiction, hypotheticals, quoted material, negation, and informational questions. The hostile corpus verifies that fictional people, fictional medication, fictional loss, and script dialogue do not become real profile memories.

Individual memory deletion is transcript-aware. Each new user turn records the identifiers of memories it created, each companion reply records the identifiers that directly grounded it, and deletion removes those turns along with any legacy turn containing the exact normalized memory value or a bounded person name in a relationship-shaped legacy echo. A name match by itself is insufficient: the Nina Simone regression proves that an unrelated turn sharing `Nina` remains. Unrelated turns and unrelated memories remain. A memory-generation guard also detects deletion while optional local-model wording is pending, discards that stale result, and recomputes a deterministic reply from the post-forget profile before saving or displaying it. This prevents a forgotten detail from lingering in the transcript or recent-context window supplied to a later optional local-model request; regression tests inspect the exact minimized context after both ordinary deletion and a delayed-reply race. A distinct privacy-session epoch invalidates the whole pending send when a private space locks, unlocks, relocks, changes role, or starts/finishes vault creation. Vault sealing synchronously blocks send, Forget, and profile mutation until the exact captured profile is encrypted; pending output cannot append transcript, relearn memory, update a care plan, speak, or cross into a different profile. Speech-recognition handlers are detached before stop, and all result, end, and error callbacks require the exact recognition instance, unchanged privacy epoch, active hands-free state, and an unlocked profile. Lock and successful unlock both centrally clear unsent input, learned-memory receipts, suggested actions, urgent state, expression, games, model/voice notices, and listening/speaking state. Buffered primary interim or final results therefore cannot reappear after lock or enter guardian space.

Tentative affect cues use a sustained change from the person's own recent communication pattern or a small self-described change, not a hidden diagnosis or a universal sentiment score. One ordinary short answer is insufficient. The companion states uncertainty, asks whether it read the situation correctly, accepts correction immediately, and never stores an inferred feeling as a fact. A bounded device-local explainability receipt contains only the basis, referenced turn IDs, baseline size, and word counts; it stores no quote, emotion label, sentiment score, or diagnosis, is visible to the user, is individually deletable, and retains at most 24 receipts. An explicit correction is remembered so the same communication pattern is not repeatedly challenged. Fiction, quotation, sarcasm markers, declared brief communication styles, medication routes, and every protected safety context are excluded; explicit acute or safety language always takes precedence.

## Interest knowledge and fictional analogies

Learning and interest packs default to on so the companion becomes more useful without repeated consent interruptions; either can be paused in Settings without erasing existing memory. The current built-in packs contain only bounded, short factual statements with direct source URLs. Episode-level facts carry a minimum season-and-episode marker and remain held until recorded progress actually reaches that point; merely naming a season is not treated as permission to reveal every episode in it.

Birthday memory is learned only from a direct first-person birthday statement. Relative phrases such as “next Saturday” are resolved against the device's local calendar and reflected back as an exact date so the person can correct it. A correction replaces the previous birthday rather than accumulating conflicting dates. The annual greeting appears at most once per local date when the primary space is opened, never in the separate guardian space, and never overrides an acute or protected safety response.

The companion may honestly describe itself as a synthetic friend. That relationship framing is meant to provide continuity and companionship without pretending to be biological or human. It must not demand exclusivity, shame the person for other relationships, threaten abandonment, or make access to the conversation conditional on contacting somebody else. It can keep listening while still naming immediate danger clearly when safety routing requires it.

Character analogies are presented as a values lens, never as literal authority or a claim that fictional powers, money, or plot protection exist in real life. A bullying conversation may offer reporting once. If the user says reporting feels unsafe, does not want to be labeled a snitch, or describes prior retaliation, that becomes a sensitive remembered boundary and the suggestion is not repeated. A new specific death threat, weapon, stalking, or planned attack can reopen outside-help options because the disclosed risk materially changed; the companion explains that change and continues talking.

Current curated sources:

- [Official Miraculous Ladybug/Marinette profile](https://www.miraculousladybug.com/characters/ladybug/)
- [Official Miraculous Season 1 Origins synopsis](https://www.miraculousladybug.com/season-1-episode-22-ladybug-cat-noir/)
- [Hasbro My Little Pony friendship description](https://newsroom.hasbro.com/news-releases/news-release-details/my-little-pony-brand-celebrates-international-day-friendship)
- [Hasbro Friendship Day character guide](https://www.hasbro.com/common/assets/html5/MyLittlePony/friendshipDay_2015/documents/en-us/pg_twilight.pdf)

## Voice and motion

Speech input is optional and device/provider dependent. Text always remains visible, one-click mute is available, and reduced-motion preferences disable nonessential animation. The native shell denies camera, display-capture, and unrelated device permissions; the microphone remains unapproved and disarmed until the user intentionally starts hands-free mode. The mascot's idle, listening, speaking, and guided-breathing motion is presentation support—not a clinical intervention.

Voice output now crosses a provider-neutral `status` / `speak` / `cancel` client contract and a matching narrow Electron broker. Both sides require exact versioned schemas. The broker also requires an explicitly approved, active, local-only provider and confirmed playback capability before it can report ready; the local-voice surface exposes no synthesis capability token, raw model/voice-pack identifier, private reference, or generated-audio path to the renderer. Only `calm-female.owner-approved.v1` and `warm-male.owner-approved.v1` may be inserted by the main-process broker after that renderer boundary. A future/unapproved preset is filtered from readiness and cannot contact synthesis. The shipped provider is deliberately inactive, so replies remain text-only and hands-free listening resumes. There is no browser or operating-system speech fallback disguised as the selected voice. Two owner-approved, hash-bound built-in samples are available only as click-to-play previews and are not presented as dynamic synthesis. Connecting any real local synthesis host remains a later integration milestone requiring a reviewed main-process adapter, real provider and playback readiness, governed output cleanup, and end-to-end listening tests.

## Reproducible evaluation

### Historical 0.2.2 checkpoint — superseded

The next paragraph is retained verbatim as historical 0.2.2 evidence. References to
the “current” source or candidate inside that paragraph describe its original
checkpoint only; they do not describe the present candidate. The current candidate
is 0.2.17 and is summarized in `CURRENT_VERIFICATION_EVIDENCE.md` and the
supersession note below.

The current 2026-08-26 source candidate passed 1,621 source tests across 28 files, including 20 focused procedural-3D and production-distribution checks, as well as all prior memory-generation/privacy-session, hands-free, and drawer-accessibility/privacy-wording regressions; the independent hostile probe passed 57/57, and TypeScript compilation and the production build passed on the current source. The 3D checks cover geometry, head-parent hierarchy, mount-once renderer lifecycle, articulation, movement, unequal curved expressions, five preview visemes, depth, lighting, reduced motion, and exclusion of concept PNGs from production output. Social rehearsal coverage exercises fear-of-ridicule coaching, a fictional introduction/small-talk/exit loop, every visible retry/return action, an unrelated “practice again” false-positive, profile and care-plan non-persistence, and self-versus-third-party acute-medical interruption. The hands-free group contains two genuine buffered interim/final callback interleavings after lock and guardian unlock. Combined automated coverage also includes everyday conversation, anger, grief, bullying and retaliation boundaries, tentative affect cues, explainability receipts, birthday date resolution and correction, medication ambiguity, and a structured ingestion event graph that composes actor identity, evidence source, factuality and temporal frame, action sense, bound object, and quantity rather than enumerating complete sentences. Generated and hostile probes cover direct speech, quoted addressees, witness and passive syntax, preposed objects, completed and future first- and third-party disclosures, unresolved uncertainty, counterfactuals, retracted intent, remote history, routine prescribed use, transport/media/task/food false-positive boundaries, numeric and word quantities, mixed ownership, suppression of memory and care-plan persistence during urgent or unresolved turns, and sentence-bounded prescriber/label schedule language. Memory coverage includes Unicode and honorific relationship names, question/doubt/retraction factuality guards, atomic achievement/interest learning, Unicode-punctuation cleanup, appositive relationship identities, transient-event separation, fiction-versus-lived-fact isolation, bounded relationship-name recall, transcript-aware deletion, and delayed local-model reply refresh after Forget. Coverage also includes acute injury, self-harm language, violence risk, third-party concern, privacy-session invalidation across primary/guardian and same-profile relock, vault-creation mutation blocking, recognition-callback isolation, local-model provenance/fallback behavior, approved voice-selector isolation, and drawer labeling/focus behavior. The known-defects register is not treated as proof of completeness; release blockers remain explicit. Current unsigned Windows candidate `Wellbeing-Companion-Working-Title-Setup-0.2.2-win32-x64.zip` contains this source snapshot, is 150,913,694 bytes, and has SHA-256 `D272F4030E1BD5F014C720905CD3B92BD648D42831E906C12B5F4F48213D6B20`. Evidence set `20260826T101439163Z-2b6fb877` retained three distinct passing exact-package runs on Windows build 26200. Every sanitized run records a distinct native title and decoded custom icon, tray, renderer sandboxing, `webgl-3d-motion`, `motionTick: 15`, `waving: true`, `movementObserved: true`, an inactive local voice provider with no system-voice fallback, and recovery from a denied hands-free request into a completed deterministic typed reply. A preceding long-path run of the same sealed ZIP also proved the root double-click setup executable, PowerShell confined beneath `Support`, absence of root `.ps1` files, verification without profile mutation, and receipt-tamper rejection. Its temporary-root lifecycle harness passed without executing the real installer or mutating a real user profile. Earlier archives remain preserved as historical evidence. A disposable Windows-user or VM owner installer run and publisher-signed public build remain pending. These results establish repeatable software behavior; they do not establish clinical efficacy or replace evaluation with clinicians and lived-experience reviewers.

### 0.2.3 verification supersession

The preceding 0.2.2 paragraph is retained as historical evidence. Candidate 0.2.3
supersedes it after the live UI regression repair: 1,626/1,626 source tests passed
across 28 files, 55/55 desktop-shell tests and syntax checks passed, and the final
unsigned ZIP is 150,914,033 bytes with SHA-256
`4CC4C804B53DDEE048A4E0D381B763870F5C940E259AB7D348D2151A6E031612`.
Evidence set `20260826T120810027Z-1ae624e4` retained three distinct passing
packaged launches bound to that exact hash. The exact-payload isolated lifecycle
harness also passed preserve-data uninstall, reinstall recovery, and explicit
remove-all without executing the real installer or mutating a real user profile.

### 0.2.4 verification supersession

The preceding 0.2.3 paragraph is retained as historical evidence. Candidate 0.2.4
supersedes it after the birthday-age, appointment-provider, general nighttime
medication-schedule, and urgent-options interaction repairs: 1,640/1,640 source
tests passed across 29 files, 55/55 desktop-shell tests and syntax checks passed,
and the final unsigned ZIP is 150,914,569 bytes with SHA-256
`FB16A75803172F46AFC0F48612C0891866165A8814221A56453570079786ED92`.
Evidence set `20260826T141748393Z-765589b3` retained three distinct passing
packaged launches bound to that exact hash. The exact-payload isolated lifecycle
harness also passed preserve-data uninstall, reinstall recovery, and explicit
remove-all without executing the real installer or mutating a real user profile.
Live browser checks with fictional data additionally confirmed corrected age,
appointment-provider, part-of-day medication, urgent-options, reload persistence,
and an already-loaded offline deterministic interest-grounded reply. Those checks
do not establish full network isolation, live voice output, microphone operation,
clinical validation, hackathon eligibility, signing, installation, or publication.

### 0.2.5 startup-reliability supersession

This section is retained as historical 0.2.5 evidence and is superseded by 0.2.6
below.

Candidate 0.2.4 is retained only as superseded, unaccepted historical evidence.
Its purported independent failure ran under the same invalid restricted-token/
profile context later identified for 0.2.5 and therefore does not prove an
intermittent product defect. Its remaining evidence lacked a valid current
real-user default-Temp gate, so it must not be staged or owner-tested. Candidate
0.2.5 warms the persistent partition's network context
against the loopback health endpoint before navigation and expands only that specific startup condition
to a bounded 24-retry, 250-millisecond window. Unrelated navigation errors still
fail immediately, and an exhausted retry window records its attempt evidence.

The 0.2.5 source passed 1,640/1,640 tests across 29 files; the desktop shell passed
57/57 tests plus JavaScript and PowerShell syntax; TypeScript and the production
Vite build passed. The exact unsigned ZIP is 150,915,742 bytes with SHA-256
`E3315AE1A0A1AD0B55D08FB9B146BAF6A77A328D58CD52EFDA05D69822D52235`.
Repeated-run set `20260826T143206282Z-8ab8a4c4` retained 10/10 distinct passing
launches from the nine-character short extraction base. Every run proved the
persistent-partition health fetch, first-attempt navigation, native window/tray/icon, fixed
loopback runtime, procedural WebGL wave, and denied-microphone typed recovery. The
isolated exact-payload lifecycle also passed without executing the installer or
mutating a real profile. This is still unsigned owner-test evidence, not generated
voice, clinical validation, organizer eligibility, a real installation, or a
published release. Three additional retained real-user runs from fresh default-Temp
roots (`root-real-user-0.2.5-03`, `-04`, and `-05`) passed 3/3 on attempt 1 with
zero retries and the same sealed hash. A restricted sandbox-identity run with a
mismatched inherited profile/DPAPI context is preserved as `INVALID_ENVIRONMENT`,
neither a product pass nor a product failure. Candidate 0.2.5 therefore remains on
OWNER-TEST CANDIDATE HOLD pending the real owner acceptance flow.

The current formal independent 0.2.5 recheck is
[`../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.5_20260826.md`](../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.5_20260826.md).
It records automated software, exact packaged process, and isolated lifecycle PASS,
while owner installation/acceptance, live generated voice, audio-timed lip sync,
clinical validation, hackathon eligibility, publication, and submission remain HOLD.

### 0.2.6 child-process compatibility supersession — historical interim

Two fresh checksum-verified 0.2.5 runs on Windows build 26200 reached the healthy
private loopback runtime but exhausted all 25 bounded renderer-navigation attempts
with `ERR_FAILED (-2)`. That reproducible current failure supersedes the older 0.2.5
pass and rejects 0.2.5 as a current owner candidate.

Candidate 0.2.6 applies a narrowly bounded Electron 43 compatibility path on Windows
builds 26200-26399: the GPU and renderer process sandboxes are disabled, while
context isolation remains enabled, Node integration and webviews remain disabled,
renderer navigation remains fixed to `127.0.0.1`, and external renderer requests
remain blocked. Other supported Windows builds retain both process sandboxes. This
security tradeoff is disclosed and remains part of owner acceptance.

The 0.2.6 source passed 1,640/1,640 tests, its explicit adversarial file passed 61/61,
the separate hostile evaluator passed 57/57 with zero registered defects, and the
desktop shell passed 57/57. The exact unsigned ZIP is 150,917,060 bytes with SHA-256
`3C68BEFCBD6A2040687AE9BC726180B223C3CDB65F07C1BB6A65EBF74CB14779`.
One direct exact-package process run and retained set
`20260826T172043613Z-3f75c559` with 3/3 distinct runs passed. The isolated exact-
payload lifecycle also passed without executing the real installer or mutating a
real profile. The formal record is
[`../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.6_20260826.md`](../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.6_20260826.md).
Owner installation and visual acceptance, live generated voice, audio-timed lip
sync, clinical validation, hackathon eligibility, publication, and submission remain
on HOLD.

### 0.2.7 sealed compatibility repair

Candidate 0.2.7 rebuilds the bounded 0.2.6 compatibility repair so both packaged
readmes and the package identity consistently name 0.2.7. The exact unsigned ZIP is
150,916,722 bytes with SHA-256
`FD977A7759285425702ECE9A903FE74C6E6926B0B1667C000F5A5AD6DC623361`.
One named direct exact-package run passed, and retained set
`20260826T173007516Z-67c8fb56` passed 3/3 distinct fresh extractions and native
process launches. The exact-payload lifecycle harness also passed without executing
the real installer or mutating a real profile. Final source evaluation passed
1,640/1,640 tests, the hostile evaluator passed 57/57, a focused memory, birthday,
privacy, offline, drawer, adversarial, and procedural-3D rerun passed 376/376, and
the desktop shell passed 57/57.

The exact package proves a custom native window and icon, notification-area tray,
fixed-loopback offline renderer, completed typed conversation after microphone
denial, and a live articulated WebGL wave. Source-level 3D tests additionally prove
the joyful hop, expressions, guided breathing, and distinct preview mouth shapes.
They do not prove generated voice or audio-timed lip sync. Owner installation and
visual acceptance, the Windows 26200-26399 compatibility tradeoff, signing, clinical
validation, organizer eligibility, publication, video, and submission remain on
HOLD. The formal record is
[`../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.7_20260826.md`](../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.7_20260826.md).

### 0.2.8 memory, conflict-context, and breathing repair

Candidate 0.2.8 supersedes 0.2.7 after a clean-origin fictional journey exposed two
conversation defects: a cousin memory could absorb a following birthday clause and
later echo `important to me` from the companion's perspective, while the built-in
60-second reset entered guided 3D motion but returned a generic text reply. The new
source bounds the person clause, renders first-person relationship details from the
user's perspective, consults recent conflict and a request for space before answering
a combined identity/contact question, and supplies the breathing guidance promised by
the reset control.

The 0.2.8 source passed 1,644/1,644 tests across 29 files, TypeScript compilation and
the Vite build passed, and the desktop shell passed 57/57 tests plus JavaScript and
PowerShell syntax. The exact unsigned ZIP is 150,920,861 bytes with SHA-256
`AB7F4E086E1083F3F636072A0F6EE165DC5819CCF9883044AC16E3C3365FD72A`.
One named exact-package verification and retained run set
`20260826T192927459Z-c34cc8c9` passed; the retained set contains 3/3 distinct runs
bound to that hash. The exact-payload temporary-root lifecycle passed shortcut and
Installed Apps shapes, preserve-data uninstall, reinstall recovery, and explicit
remove-all without executing the real installer or mutating a real user profile.

A clean-origin browser replay additionally confirmed the corrected cousin/birthday/
space scenario, the real WebGL canvas and advancing motion ticks for wave, happy, and
guided-breathing states, the corrected breathing reply, and zero browser warnings or
errors. This is still automated software evidence, not clinical validation, generated
voice, audio-timed lip sync, a real-profile installation, or owner visual acceptance.
Signing, the Windows 26200-26399 compatibility tradeoff, organizer eligibility,
publication, video, and submission remain on HOLD. The formal record is
[`../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.8_20260826.md`](../verification/FORMAL_INDEPENDENT_OWNER_TEST_RECHECK_0.2.8_20260826.md).

### 0.2.17 first-run voice and readability supersession

Candidate 0.2.17 supersedes 0.2.13 after an exact-package first-run probe exposed
the need for a longer bounded cold-cache voice readiness window and a genuine
onboarding-to-playback integration check. The sealed unsigned ZIP is 153,022,972
bytes with SHA-256
`15C4B81715EED36D9A3B2958CAF6803A5EED158B717A55709319228A2233BC67`.
Application tests passed 1,679/1,679 across 34 files, desktop tests passed 80/80,
TypeScript and the production build passed, the exact package verification passed,
both local media probes passed, the isolated lifecycle passed, and three fresh
packaged smokes passed 3/3.

The exact first-run voice probe passed twice. With a fixed synthetic preferred name
and the microphone left at **Not now**, it observed no microphone request, waited for
the cache-only local voice, observed actual personalized welcome playback, then
entered the main UI. Full and compact welcome text was exact and unclipped. Blink,
wave, and playback-timed mouth movement were observed. This remains automated
software evidence; owner installation, publisher signing, clinical/accessibility
review, organizer eligibility, publication, and submission remain on HOLD.

## Asset provenance and current motion truth

The current production character asset is an original reviewed **2D sprite sheet**,
`companion-warm-plum-speech-sprite-v3.png`, built from project-original generated
art and containing no real person. The runtime identifies its renderer as
`reviewed-sprite-sheet-2d`. It supports irregular blink frames, an opening wave, and
mouth frames driven only after confirmed local playback supplies waveform amplitude
plus bounded text-class timing. This is not a natural 3D character, skeletal motion,
or a general claim of phoneme-accurate lip sync. Earlier procedural-WebGL paragraphs
are retained as historical checkpoints and do not describe the current renderer.

## Current track fit

The strongest primary category is Mental Health. The same implemented evidence supports consideration for Responsible AI/Data Safety, Best AI/ML, Best Design, Innovation, and Public Vote where the final submission form permits those categories: a real local model pipeline, a bounded deterministic health-safety layer, device-local memory with an optional encrypted vault, explainable per-response provenance, accessibility controls, and reproducible adversarial evaluation are all present. Category eligibility and selections must still be confirmed in the final Devpost form before submission.
