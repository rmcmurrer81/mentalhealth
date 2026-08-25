# Current verification evidence — working title

**Evidence date:** 2026-08-25 EDT

**Sealed-package source revision:** `a49cdc6971ef19c682037cb4adec77d30843538e`

**Product identity:** `[FINAL PRODUCT NAME]` remains intentionally unresolved.

This is the sanitized, repository-safe summary for the current source and Windows
candidate. It contains no conversation content, health records, local machine paths,
account identifiers, or credentials.

## Current source and package gates

- Source behavior: **433/433 tests passed** across **70/70 reported suites**.
- Independent hostile evaluation: **57/57 scenarios passed**.
- Windows desktop shell: **51/51 tests passed**.
- TypeScript compilation and the Vite production build passed.
- The evaluated known-defects inventory contained **0 open entries**. This is a
  bounded result for the tested revision, not a claim that the product can have no
  defects.
- The additional three source tests cover drawer accessibility and visible privacy
  wording. They are included in the sealed Windows archive below.
- These are software and adversarial-scenario tests, **not clinical validation**,
  diagnostic evaluation, or evidence of treatment effectiveness.

## Current Windows candidate

This exact candidate was built from revision
`a49cdc6971ef19c682037cb4adec77d30843538e` and contains the tested 433-test
drawer-accessibility/privacy-language source revision.

- Archive: `Wellbeing-Companion-Working-Title-Setup-0.1.0-win32-x64.zip`
- Size: **175,045,666 bytes**
- SHA-256: `88CBCD8864A815411C6971180EA3A4C3A1479B2A858C9CFF73EB5AB3CF67632E`
- Authenticode status: **NotSigned**
- Three consecutive bounded packaged-process smokes passed. Each started the actual
  packaged executable and required a native window, tray, renderer, fixed-loopback
  health response, local-storage round trip, an unapproved and disarmed microphone
  at startup, and denied camera, display-capture, and generic device permissions.
- The package smoke did not invoke the optional Ollama wording layer and did not
  claim speech-output playback. The shipped local-voice provider remains inactive.

## Lifecycle boundary

The isolated lifecycle harness passed shortcut and Installed-Apps shapes,
preserve-data uninstall, reinstall recovery, and explicit remove-all using the exact
sealed payload beneath a temporary root. It recorded `realUserProfileMutated: false`
and `actualInstallerExecuted: false`. It **does not** replace running the real
installer in a disposable Windows user or virtual machine.

## Product truth boundary

- Typed conversation, local memory, reminders, games, and deterministic safety can
  run locally without an internet connection.
- Hands-free recognition uses Chromium/Web Speech and may be unavailable or may use
  an operating-system or browser-vendor online service. Offline core does not mean
  every speech configuration is offline.
- The normal device-local profile is not described as blanket encrypted storage. A
  user may enable the optional password vault; that protected profile uses
  PBKDF2-SHA-256 and AES-256-GCM. Primary and guardian vault roles are separated.
- Optional Ollama wording is loopback-only and limited to ordinary steady
  conversation. Protected routes remain deterministic.
- No clinical validation, diagnosis, prescribing, dose changes, emotion-reading,
  or guaranteed crisis outcome is claimed.

## Remaining release and submission gates

- `[FINAL PRODUCT NAME]`, `[OWNER NAME]`, `[GITHUB URL]`,
  `[HOSTED OR DEMO URL]`, and `[VIDEO URL]` must be resolved by the owner.
- The owner must run the exact candidate and complete the planned install, preserve,
  reinstall, and remove-all checks in a disposable Windows user or virtual machine.
- A normal public Windows release needs publisher signing; this archive must remain
  labeled as an unsigned test candidate until then.
- The public repository, downloadable judge path, final product captures, accessible
  video at four minutes or less, retimed English captions, link checks, and final
  owner approval are still pending.
- Any source change selected for submission requires a rebuild, three packaged
  smokes, the lifecycle harness, a new checksum seal, and replacement of the exact
  package size and checksum everywhere before recording.

Historical receipts under the local verification archive remain useful for audit
history but do not supersede the current 433-test package and exact seal above.
