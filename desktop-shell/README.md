# Wellbeing companion Windows desktop — working title

This folder packages the current working-title companion as an independent Windows
application. It does not open in Chrome or Edge. The packaged executable starts a
small static service bound only to `127.0.0.1:43724` and loads the production Vite
build in an Electron window with context isolation and Node integration disabled.
Conversation, deterministic safety routing,
local memory, reminders, interest packs, and the optional encrypted vault can run
without internet access.

The user will choose the final friendly product name later. Internal filenames and
ownership markers deliberately retain `WorkingTitle` so this development package
does not pre-empt that choice.

## Desktop and privacy behavior

- The app has its own window, notification-area lifecycle, custom lantern icon,
  Desktop shortcut, Start-menu shortcut, and Installed Apps entry.
- Closing ordinary browser windows cannot close it. Closing the app window offers
  **Keep running**, **Quit**, and **Cancel**.
- Its Chromium profile is stored beneath
  `%APPDATA%\WellbeingCompanionWorkingTitle\UserData`, outside the program folder.
  Ordinary uninstall preserves both local and roaming companion data. Removing all
  data is a separate explicit choice.
- The renderer uses context isolation, no Node integration, no webviews, and no
  renderer access to Electron APIs beyond a narrow preload bridge.
- On Windows builds 26200-26399 only, Electron 43 uses a disclosed child-process
  compatibility path that disables the GPU and renderer process sandboxes after
  repeatable child-process launch failures. The fixed loopback origin, navigation
  restrictions, context isolation, disabled Node integration, and disabled webviews
  remain enforced. Other supported builds retain the renderer and GPU sandboxes.
- Renderer HTTP(S) requests are blocked unless they target the fixed companion
  loopback origin. External HTTPS and email links require confirmation and open in
  the operating-system default app.
- Before the first window navigation, the persistent partition's network context
  verifies the fixed loopback health endpoint. Only an `ERR_FAILED (-2)` startup
  result receives a bounded 24-retry, 250-millisecond window with
  explicit attempt evidence; unrelated navigation errors still fail closed.
- First run asks for preferred name, soft-female or warm-male local voice,
  light/default-medium/dark theme, and whether to set up hands-free input. Before
  any microphone request it explains that the app cannot silently grant or bypass
  Windows permission. The native prompt is default-deny and temporarily arms
  audio-only access. Stopping, muting capture, hiding, locking, changing private
  space, or quitting stops tracks and disarms it. Camera, display capture, generic
  device permissions, downloads, and combined audio/video requests fail closed.
- Installed hands-free input records one bounded in-memory turn with `MediaRecorder`
  and sends it only to an authenticated ephemeral-loopback, cache-only
  `faster-whisper-small.en` host. Raw audio and transcript files are not written.
  The model cache and Python packages are external dependencies; if they are absent,
  text conversation remains available. The browser development view may retain its
  separate browser recognition fallback, but the installed route does not use it.
- The renderer and preload expose only a versioned `status` / `speak` / `cancel`
  local-voice contract. Candidate 0.2.25 connects it to a separately spawned,
  authenticated loopback Chatterbox host using the two hash-bound original synthetic
  references. The host forces offline model access, caps requests, owns playback,
  and is terminated with the app. It never exposes its token, model identity, port,
  or generated-audio path to the renderer. The roughly 3.2 GB model cache, Python
  3.14 packages, and CUDA runtime remain external local dependencies and are not
  bundled. If they are unavailable, complete text remains visible and no Chromium,
  Windows, or named-person substitute voice is used. The renderer marks speech only
  after an output-only actual-playback event and receives bounded amplitude/text-class
  timing—not conversation text, raw audio, or a generated-audio path. Mute cancels
  both active generation and active Windows playback.

## Optional local model boundary

The desktop bridge can optionally ask a locally installed Ollama process at the
fixed address `http://127.0.0.1:11434` to warm the wording of an already-generated
deterministic reply. The product attempts it only on an eligible steady route when
an allowlisted model is locally available; every failure keeps the deterministic
reply. It is not a cloud model and accepts no arbitrary host.

- Default model: `llama3.1:8b`.
- Allowlist: `llama3.1:8b`, `qwen3.5:9b`; only locally installed members are offered.
- Exact `steady` / `ordinary-support` route only. Urgent, strained, self-harm,
  bullying, harassment, reporting-retaliation, threat, stalking, violence, abuse,
  assault, grief, loss, medication, dose, prescription, diagnosis, treatment, and
  prompt-injection-shaped text stays deterministic.
- Requests are UUID-bound, schema-limited, control-character stripped, capped at
  32 KiB, six recent turns, and bounded text lengths. Memories, medication records,
  appointments, vault contents, and contact details have no IPC fields.
- Calls use a bounded 20-second cold-start-aware timeout and 128 KiB response cap. Candidate prose is
  limited to 1,200 characters, plain text, no links, no actions, and explicit
  provenance. Any failure returns a deterministic-fallback requirement.
- The bridge logs no prompt, reply, or health text. Package verification records its
  static boundary but deliberately does not invoke Ollama or claim model quality.

## Build and verify

Run the source production build first, then:

```powershell
pnpm test
pnpm build
pnpm --dir desktop-shell test
pnpm --dir desktop-shell lint
pnpm --dir desktop-shell pack:win
pnpm --dir desktop-shell test:lifecycle
pnpm --dir desktop-shell verify:win
pnpm --dir desktop-shell verify:win:three
powershell -NoProfile -ExecutionPolicy RemoteSigned -File desktop-shell/scripts/Run-ThreePackagedSmokes.ps1 -RunCount 3
```

The package builder pins Electron 43.4.1 and checks its official archive SHA-256
before staging. It produces:

- `release\win-unpacked\WellbeingCompanionWorkingTitle.exe`
- `release\Wellbeing-Companion-Working-Title-Setup-0.2.25-win32-x64.zip`
- the ZIP `.sha256.txt` sidecar and external `.receipt.json`
- embedded build and setup receipts with exact file manifests

The verifier rechecks those manifests, extracts and validates the setup archive,
rejects automatic external font/CDN URLs, and starts the actual packaged executable
with isolated user data. The bounded smoke requires a real window, tray, branded
renderer, fixed loopback health response, localStorage round trip, absent renderer
`require`/`process`, unarmed microphone at startup, denied camera/display/device
permissions, the static local-model boundary, and the three-method local-voice IPC
boundary in fail-closed smoke mode with no provider activation, playback, or
system-voice fallback. Exact authored-file verification separately binds the
Chatterbox adapter/host/references, local-speech adapter/host/fixed synthetic probe,
the reviewed 4-by-2 friendly character sheet, loopback/authentication/offline-cache
boundaries, and absence of bundled model weights.
It also requires the exact renderer-session warmup and bounded initial-navigation
attempt receipt.

`verify:win:three` invokes that verifier three times by default and archives each run
before the next can overwrite the working receipt. The same script accepts a bounded
`-RunCount 3..20`; counts above three write `REPEATED-RUN-SUMMARY.json`. It binds all
distinct run IDs to one package hash and writes `PASS` only when every required run
completes. Raw receipts remain local because they can include a Windows user-data
path; a sanitized copy removes that field. Do not claim three retained runs merely
because the wrapper exists, and do not publish raw receipts.

`Test-IsolatedLifecycle.ps1` extracts the exact sealed payload beneath a unique temp
root and exercises install-shaped files, Desktop/Start shortcut shapes, an
Installed-Apps-shaped record, preserve uninstall, reinstall with recovered
sentinels, and explicit remove-all. It does not touch the real user profile, real
HKCU uninstall key, or real shortcuts. A disposable Windows user or VM is still
required before calling the actual installer lifecycle dynamically verified.

## Install and uninstall

Extract the setup ZIP completely, open the extracted folder, and double-click
`SETUP-WELLBEING-COMPANION.exe`. Do not drag individual files out of the ZIP. The
PowerShell implementation is deliberately kept beneath `Support` so ordinary setup
does not open installer source in a text editor.

The development executable and setup launcher may be Authenticode `NotSigned`.
The build and verification receipts now bind the official Electron archive hash,
the upstream `electron.exe` hash and Authenticode state, the selected runtime hash,
and whether rename changed any bytes. Candidate 0.2.25 applies no runtime resource
mutation and its renamed host is byte-for-byte identical to the pinned official
Electron 43.4.1 host; that upstream host is itself `NotSigned`, so this preservation
does not create an Electron or Microsoft publisher chain. A future supplied signed
runtime must match both an explicit SHA-256 and an explicit signer thumbprint. Windows
Smart App Control or reputation protection may still show its own operating-system warning.
The launcher itself uses normal welcome, location/shortcut review, real worker-tied
progress, and finish pages—without custom unsigned-warning or completion popups and
without an artificial delay. The receipt-bound support call uses
`-AcceptVerifiedUnsignedRuntime` internally after the wizard validates its sealed
support path; the flag does not make either executable signed.

Installed Apps or the Start-menu uninstall shortcut offers preservation by default
and a separate explicit remove-all choice. Managed removal can use `-PreserveData` or
`-RemoveAllData`. Both paths preflight ownership markers, exact known-folder
boundaries, shortcuts, the uninstall key, and reparse points before deletion.

## Honest remaining gates

- A public consumer build still needs a Kira Labs Authenticode publisher certificate.
- The no-certificate public alternative is an owner-controlled Microsoft Store MSIX
  submission that Microsoft signs only after certification. It requires Partner
  Center identity verification, a reserved final name and assigned package identity,
  exact manifest values, submission assets, and Store acceptance. The current machine
  has no MSIX packaging/signing tool or code-signing certificate, so no local artifact
  is represented as Store-ready or Microsoft-signed.
- The real installer/preserve/reinstall/remove-all flow needs a disposable Windows
  user or VM; this lane does not mutate the current user's profile.
- Packaged voice and speech remain dependency- and device-dependent. The exact-archive
  acceptance lane includes a fixed synthetic audible Chatterbox playback plus a
  playing-phase mute cancellation and a separate fixed synthetic local transcription
  that opens no microphone and retains no transcript text in its receipt. Other
  computers without the external Python/model/compute dependencies remain text-only.
  Owner discovery, real microphone, playback, mute, and cleanup testing are still required.
- Candidate 0.2.25 contains the current source and desktop-shell regression suites,
  adds default always-on-top behavior (with an explicit unpin control) to the compact
  character-first and character-only window modes, and supersedes
  0.2.8 plus the earlier repair packages. Two fresh exact 0.2.5 runs reached the healthy loopback
  runtime but exhausted every bounded renderer-navigation attempt. Candidate 0.2.25
  repairs that current failure with the disclosed build-26200-26399 child-process
  compatibility boundary. It remains on unsigned OWNER-TEST CANDIDATE HOLD. Use it only with
  its matching sidecar, package receipt, and current sanitized verification evidence.
  Its packaged-process probe must prove
  the reviewed friendly sprite renderer and advancing motion, distinct native identity and custom icon, a
  fail-closed smoke voice boundary with no system-voice fallback, and recovery from denied
  hands-free permission to a completed typed deterministic reply. Setup verification
  must also prove the root double-click launcher, PowerShell confined to `Support`,
  absence of root `.ps1` files, receipt-tamper rejection, and a safe Explorer path
  budget. Use only the matching external SHA-256 sidecar and current verification
  evidence; those are generated after the archive and therefore are not copied into
  the archive's self-description. Earlier packages and their receipts remain intact
  as historical evidence.
- Optional Ollama wording is not a clinical model and does not replace the
  deterministic safety classifier or response validator.
- No hosted URL, public repository, cloud AI, email connector, upload, or hackathon
  submission is created by this packaging lane.
