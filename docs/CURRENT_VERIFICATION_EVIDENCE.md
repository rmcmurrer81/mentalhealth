# Current verification evidence — Wellbeing Companion 0.2.25

Automated owner-test candidate: **PASS**

Owner visual, conversational, and real-installer acceptance: **REQUIRED**

Normal public binary release: **HOLD**

True real-time 3D character: **NOT PRESENT — temporary animated orb only**

Human clinical validation: **NOT PERFORMED**

## Exact candidate

- Archive: `desktop-shell/release/Wellbeing-Companion-Working-Title-Setup-0.2.25-win32-x64.zip`
- Bytes: `151064373`
- SHA-256: `B8BD41EC9BFEDE4C639EB8189E35215C43819950EDAE0FD740FE7E3387E9F230`
- Setup launcher: **unsigned owner-test build**
- Normal Windows security bypass: **not used**
- Known-good rollback 0.2.21 SHA-256:
  `2394DB248A019166D9F0D0CFE8992CC90943787D9C9744F5ED73E8CC84B2DE0E`

## Current verified results

- Source tests: **1,733/1,733** in **41/41** files.
- Synthetic conversation benchmark: **280/280** checks in **3/3** tests.
- Desktop tests in the sealed-candidate run: **81/81**.
- Desktop JavaScript, PowerShell syntax, TypeScript, and Vite production build:
  **PASS**.
- Fresh or legacy profiles without a saved marker default spoken replies on; an
  explicit mute choice persists.
- Bored-to-school/work-stress continuation: **PASS**.
- Exact checksum-bound package launch, window, tray, offline runtime, renderer,
  permission boundary, and denied-microphone typed recovery: **PASS**.
- Exact-package local Chatterbox voice, cache-only local speech, and onboarding
  playback probes: **PASS** on the tested machine.
- Three distinct exact-package startup smokes: **3/3 PASS**.
- Exact-payload isolated preserve/reinstall/remove-all lifecycle: **PASS**.
- The normal UI mounts one stable temporary animated orb with accessible state text,
  playback energy, reduced-motion behavior, and no packaged legacy sprite.
- The strict 3D gate remains intentionally failed: no WebGL scene, live 3D mesh,
  licensed rigged GLB, or mesh-render-call evidence is present.

## Evidence index

- `verification/AUTOMATED_CANDIDATE_STATUS_0.2.25_20260901.md`
- `verification/CONVERSATION_QUALITY_BENCHMARK_LATEST.json`
- `verification/CONVERSATION_QUALITY_BENCHMARK_LATEST.md`
- `desktop-shell/verification/DESKTOP-PACKAGE-VERIFICATION.json`
- `desktop-shell/verification/ISOLATED-LIFECYCLE-VERIFICATION.json`
- `desktop-shell/verification/PACKAGED-LOCAL-VOICE-PROBE-0.2.25.json`
- `desktop-shell/verification/PACKAGED-LOCAL-SPEECH-PROBE-0.2.25.json`
- `desktop-shell/verification/PACKAGED-ONBOARDING-VOICE-PROBE-0.2.25.json`
- `desktop-shell/verification/packaged-smoke-runs/20260901T155822511Z-e8ec1203/THREE-RUN-SUMMARY.json`

The `desktop-shell/verification/` receipts and release archive are intentionally
ignored by the source repository. Publish them separately only after owner approval.

## Holds and limits

- Automated engineering evidence does not prove every possible phrase, clinical
  effectiveness, diagnosis, treatment safety, cultural completeness, or accessibility
  acceptance.
- A fresh documentation-audit rerun passed 80 desktop tests and encountered one
  `EADDRINUSE` failure because the owner was actively running the installed app on
  the same fixed loopback port. Do not call that fresh run 81/81 until the app is
  closed and the suite is rerun.
- Real owner review is still needed for empathy, context continuity, layout, orb
  motion, voice naturalness, default-on speech, explicit mute persistence, and
  end-to-end usability.
- The setup launcher is unsigned and may be blocked by Windows. Do not weaken Windows
  security controls.
- Local voice and speech model caches are not bundled; another computer may remain
  text-only.
- The lifecycle check used an isolated filesystem harness with the exact payload; it
  did not execute the real installer in a disposable Windows account or VM.
- Hackathon eligibility for the disclosed AI-assisted development workflow still
  requires written organizer confirmation.

Any production-code or packaged-asset change invalidates the exact archive hash and
requires a new package verification cycle. Documentation-only public-submission files
do not alter the sealed package bytes.
