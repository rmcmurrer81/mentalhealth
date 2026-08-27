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
- Microphone access is not requested at startup. Clicking hands-free invokes the
  narrow preload bridge, opens a default-deny native prompt, and temporarily arms
  audio-only access. Stopping or hiding the app disarms it. Camera, display capture,
  generic device permissions, downloads, and combined audio/video requests fail
  closed.
- Text conversation always remains available. Chromium speech recognition may be
  unavailable or backed by a device/vendor online service; this package does not
  claim guaranteed offline speech recognition.
- The renderer and preload expose only a versioned `status` / `speak` / `cancel`
  local-voice contract. Candidate 0.2.12 connects it to a separately spawned,
  authenticated loopback Chatterbox host using the two hash-bound original synthetic
  references. The host forces offline model access, caps requests, owns playback,
  and is terminated with the app. It never exposes its token, model identity, port,
  or generated-audio path to the renderer. The roughly 3.2 GB model cache, Python
  3.14 packages, and CUDA runtime remain external local dependencies and are not
  bundled. If they are unavailable, complete text remains visible and no Chromium,
  Windows, or named-person substitute voice is used.

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
- `release\Wellbeing-Companion-Working-Title-Setup-0.2.12-win32-x64.zip`
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
Chatterbox adapter, Python host, reviewed reference hashes, loopback/authentication/
offline-only source boundaries, and absence of bundled model weights.
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

The development executable and setup launcher may be Authenticode `NotSigned`. The
launcher verifies the exact setup/build receipts and opens a cancel-first warning;
installation continues only when the user explicitly accepts the checksum-verified
unsigned build. `-AcceptVerifiedUnsignedRuntime` is an internal controlled-test
acknowledgement used by the receipt-bound support script; it does not make either
executable signed.

Installed Apps or the Start-menu uninstall shortcut offers preservation by default
and a separate explicit remove-all choice. Managed removal can use `-PreserveData` or
`-RemoveAllData`. Both paths preflight ownership markers, exact known-folder
boundaries, shortcuts, the uninstall key, and reparse points before deletion.

## Honest remaining gates

- A public consumer build still needs a Kira Labs Authenticode publisher certificate.
- The real installer/preserve/reinstall/remove-all flow needs a disposable Windows
  user or VM; this lane does not mutate the current user's profile.
- Packaged speech recognition remains device-dependent. The local-speech IPC broker
  is fail-closed. One bounded source-provider probe on the development computer
  loaded the already-cached Chatterbox model, synthesized a generic female line,
  and confirmed local playback. The exact installed 0.2.12 package has not yet
  repeated that audible test, and other computers without the external Python/CUDA/
  cache dependencies remain text-only. Owner discovery, playback, mute, and cleanup
  testing are still required.
- Candidate 0.2.12 contains the current 1,663-test source and 69-test desktop shell,
  adds default always-on-top behavior (with an explicit unpin control) to the compact
  character-first and character-only window modes, and supersedes
  0.2.8 plus the earlier repair packages. Two fresh exact 0.2.5 runs reached the healthy loopback
  runtime but exhausted every bounded renderer-navigation attempt. Candidate 0.2.12
  repairs that current failure with the disclosed build-26200-26399 child-process
  compatibility boundary. It remains on unsigned OWNER-TEST CANDIDATE HOLD. Use it only with
  its matching sidecar, package receipt, and current sanitized verification evidence.
  Its packaged-process probe must prove
  genuine WebGL motion and wave, distinct native identity and custom icon, a
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
