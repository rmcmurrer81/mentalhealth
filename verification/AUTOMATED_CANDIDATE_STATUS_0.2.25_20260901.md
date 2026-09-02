# Automated candidate status — Wellbeing Companion 0.2.25

Automated owner-test candidate: **PASS**

Owner visual and conversational acceptance: **REQUIRED**

Public release: **HOLD**

True real-time 3D character: **NOT PRESENT — temporary orb only**

Human clinical validation: **NOT PERFORMED**

## Exact package

- Archive: `Wellbeing-Companion-Working-Title-Setup-0.2.25-win32-x64.zip`
- Bytes: `151064373`
- SHA-256: `B8BD41EC9BFEDE4C639EB8189E35215C43819950EDAE0FD740FE7E3387E9F230`
- Setup launcher: **unsigned owner-test build**
- Windows security bypass: **not used**
- Known-good rollback 0.2.21: SHA-256
  `2394DB248A019166D9F0D0CFE8992CC90943787D9C9744F5ED73E8CC84B2DE0E`
- Failed 0.2.22, 0.2.23, and 0.2.24 archives remain preserved as failure evidence.

## Source-logic results

- Full renderer/source suite: **1,733/1,733** tests in **41/41** files.
- Conversation-quality benchmark: **280/280** checks in **3/3** tests.
- Desktop tests: **81/81**; desktop lint and PowerShell syntax: **PASS**.
- TypeScript and Vite production build: **PASS**.
- Fresh/no-marker speech preference defaults on while explicit off persists: **PASS**.
- Bored-to-school/work-stress Civil War report context continuation: **PASS**.
- Three source-tree offscreen smokes: **3/3 PASS**, each with `motionTick: 15`
  and `runtimeObserved: true`.

## Exact-package results

- Exact checksum-bound ZIP payload launch: **PASS**.
- Window, tray, renderer, offline runtime, and denied-microphone typed recovery:
  **PASS**.
- Real temporary-orb runtime requirement: **PASS**, including `motionTick >= 15`
  and `runtimeObserved: true`; no visual gate was weakened or synthesized.
- Exact-package local Chatterbox voice: **PASS**.
- Exact-package local speech: **PASS**, with no microphone request or persisted raw audio.
- Onboarding voice: **PASS**, including actual playback and no microphone request.
- Three distinct exact-package startup smokes: **3/3 PASS**.
- Final standalone exact-package verification: **PASS**, run
  `single-20260901T155915861Z-1e6e0d88`.
- Exact-payload isolated lifecycle harness: **PASS** for setup hash verification,
  shortcut and Installed Apps shape, keep-data uninstall, reinstall recovery, and
  explicit delete-all.

## Evidence

- `desktop-shell/verification/source-smoke-runs/20260901T155433822Z-ba2f6d24/run-01.json`
- `desktop-shell/verification/source-smoke-runs/20260901T155433822Z-ba2f6d24/run-02.json`
- `desktop-shell/verification/source-smoke-runs/20260901T155433822Z-ba2f6d24/run-03.json`
- `desktop-shell/verification/PACKAGED-LOCAL-VOICE-PROBE-0.2.25.json`
- `desktop-shell/verification/PACKAGED-LOCAL-SPEECH-PROBE-0.2.25.json`
- `desktop-shell/verification/PACKAGED-ONBOARDING-VOICE-PROBE-0.2.25.json`
- `desktop-shell/verification/packaged-smoke-runs/20260901T155822511Z-e8ec1203/THREE-RUN-SUMMARY.json`
- `desktop-shell/verification/DESKTOP-PACKAGE-VERIFICATION.json`
- `desktop-shell/verification/ISOLATED-LIFECYCLE-VERIFICATION.json`

## Holds and limits

- Automated engineering evidence is not human clinical review or proof that every
  possible phrase will be handled correctly.
- Owner acceptance is still needed for empathy, tone, context continuity, layout,
  orb motion, voice naturalness, default-on speech behavior, persistence of an
  explicit mute choice, and end-to-end usability.
- The temporary orb remains because a production-quality true 3D character is not
  present in this candidate.
- The setup launcher is unsigned and can be blocked by Windows. Do not weaken security.
- The lifecycle check used an isolated filesystem harness with the exact payload;
  it did not execute the real installer in a disposable Windows account or VM.
- Local voice and speech caches are not bundled for another computer.

Any production-code or packaged-asset change invalidates this exact archive hash
and requires a new package verification cycle. Documentation added outside the
sealed package does not alter its bytes.
