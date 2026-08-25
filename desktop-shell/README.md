# Wellbeing companion Windows desktop — working title

This folder packages the current working-title companion as an independent Windows
application. It does not open in Chrome or Edge. The packaged executable starts a
small static service bound only to `127.0.0.1:43724` and loads the production Vite
build in a sandboxed Electron window. Conversation, deterministic safety routing,
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
- The renderer is sandboxed with context isolation, no Node integration, no webviews,
  and no renderer access to Electron APIs beyond a narrow preload bridge.
- Renderer HTTP(S) requests are blocked unless they target the fixed companion
  loopback origin. External HTTPS and email links require confirmation and open in
  the operating-system default app.
- Microphone access is not requested at startup. Clicking hands-free invokes the
  narrow preload bridge, opens a default-deny native prompt, and temporarily arms
  audio-only access. Stopping or hiding the app disarms it. Camera, display capture,
  generic device permissions, downloads, and combined audio/video requests fail
  closed.
- Text conversation always remains available. Chromium speech recognition may be
  unavailable or backed by a device/vendor online service; this package does not
  claim guaranteed offline speech recognition.
- The renderer and preload expose only a versioned `status` / `speak` / `cancel`
  local-voice contract. Main-process validation requires an approved, active,
  local-only provider plus playback readiness, but the shipped provider is
  deliberately inactive. The local-voice surface exposes no synthesis capability
  token, voice/model identifier, or generated-audio path to the renderer. Spoken
  output is therefore text-only and never falls
  back to Chromium or a Windows system voice as though it were the selected preset.

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
```

The package builder pins Electron 43.4.1 and checks its official archive SHA-256
before staging. It produces:

- `release\win-unpacked\WellbeingCompanionWorkingTitle.exe`
- `release\Wellbeing-Companion-Working-Title-Setup-0.1.0-win32-x64.zip`
- the ZIP `.sha256.txt` sidecar and external `.receipt.json`
- embedded build and setup receipts with exact file manifests

The verifier rechecks those manifests, extracts and validates the setup archive,
rejects automatic external font/CDN URLs, and starts the actual packaged executable
with isolated user data. The bounded smoke requires a real window, tray, branded
renderer, fixed loopback health response, localStorage round trip, absent renderer
`require`/`process`, unarmed microphone at startup, denied camera/display/device
permissions, the static local-model boundary, and the three-method local-voice IPC
boundary with no configured provider, verified playback, or system-voice fallback.

`Test-IsolatedLifecycle.ps1` extracts the exact sealed payload beneath a unique temp
root and exercises install-shaped files, Desktop/Start shortcut shapes, an
Installed-Apps-shaped record, preserve uninstall, reinstall with recovered
sentinels, and explicit remove-all. It does not touch the real user profile, real
HKCU uninstall key, or real shortcuts. A disposable Windows user or VM is still
required before calling the actual installer lifecycle dynamically verified.

## Install and uninstall

Extract the setup ZIP completely. Then run:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\Install-WellbeingCompanion.ps1
```

The development executable may be Authenticode `NotSigned`. The installer verifies
the exact setup/build receipts and then defaults to cancel unless the user explicitly
accepts the checksum-verified unsigned build. `-AcceptVerifiedUnsignedRuntime` is the
equivalent controlled-test acknowledgement; it does not make the executable signed.

Installed Apps or the Start-menu uninstall shortcut offers preservation by default
and a separate explicit remove-all choice. Managed removal can use `-PreserveData` or
`-RemoveAllData`. Both paths preflight ownership markers, exact known-folder
boundaries, shortcuts, the uninstall key, and reparse points before deletion.

## Honest remaining gates

- A public consumer build still needs a Kira Labs Authenticode publisher certificate.
- The real installer/preserve/reinstall/remove-all flow needs a disposable Windows
  user or VM; this lane does not mutate the current user's profile.
- Packaged speech recognition remains device-dependent. The local-speech IPC broker
  is fail-closed and its shipped provider is inactive; real synthesis and audible
  playback are not connected or claimed. A later provider integration requires a
  rebuild, full end-to-end listening checks, and a new package seal.
- The prior sealed development archive includes the provider-neutral renderer,
  inactive fail-closed local-voice broker, and approved static previews, but it
  predates and does not contain the current multi-clause memory extraction,
  deterministic recall, provenance-linked transcript forgetting and Nina collision
  fix, in-flight Forget reply refresh, or privacy-session/vault-transition race
  fixes. It also predates the buffered speech-recognition callback isolation that
  binds callbacks to the exact unlocked privacy session. It is superseded package
  evidence, not the current source package. Use its exact ZIP only with the matching
  SHA-256 sidecar and external receipt; rebuild and reseal before distributing the
  current source.
- Optional Ollama wording is not a clinical model and does not replace the
  deterministic safety classifier or response validator.
- No hosted URL, public repository, cloud AI, email connector, upload, or hackathon
  submission is created by this packaging lane.
