# Wellbeing Companion 0.2.12 — formal owner-test status

Status: **OWNER TEST REQUIRED**  
Public release: **not approved**  
Hackathon submission: **not approved by this evidence**

## Exact candidate

- Archive: `desktop-shell/release/Wellbeing-Companion-Working-Title-Setup-0.2.12-win32-x64.zip`
- Bytes: `150944898`
- SHA-256: `A99C19ECAF782147FB54AD4CB46D910126A8E8796EC9A98753B0CFBFB5683F65`
- Authenticode: **NotSigned**
- Version 0.2.11 remains preserved and was not overwritten.

## What is verified

- Renderer/domain: **1,663/1,663 tests passed in 32/32 files**.
- Desktop/installer: **69/69 tests passed**.
- TypeScript, Vite production build, JavaScript lint, and PowerShell syntax: **PASS**.
- Exact sealed-package direct verifier: **PASS**, requested run `single-0.2.12-owner-review`.
- Three additional checksum-bound packaged launches: **PASS 3/3**, run set `20260827T082604418Z-09cb4e84`. The retained current verifier receipt is run `20260827T082604418Z-09cb4e84-run-03`.
- Exact sealed-payload temporary-root lifecycle: **PASS** for install-shaped files, shortcut and Installed-Apps shapes, preserve data, reinstall recovery, and explicit remove-all. Automation did not execute the real installer or mutate the real owner profile.
- Fresh visual journey: **8/8 captures produced**, with owner review still required. The compact 440 × 760 capture shows the complete opening reply ending with “What would you like me to call you?”
- User-facing typography has a 12 px floor; compact conversation and composer text are 14 px. Saved turns render without line clamps and remain available in a bounded scroll area.
- A normal Windows Forms uninstall flow now offers preserve-data by default or explicit remove-all and closes only the exact owned app path before uninstalling. Its source and isolated lifecycle regressions pass; the installed GUI flow still needs owner acceptance.

## Voice evidence and boundary

A bounded **source-provider** test used the already-installed local Chatterbox stack, existing model cache, and reviewed `soft-feminine` synthetic reference. It reached ready, generated audible local playback, and shut down successfully. The receipt is `CHATTERBOX_SOURCE_PROVIDER_AUDIBLE_PROBE_20260827.json`.

The 0.2.12 regressions additionally require the first fresh greeting to remain queued while Chatterbox warms and to speak once the local voice is ready. Muting clears any pending playback. The sealed package binds the adapter, Python host, and reviewed synthetic references; it does not bundle the multi-gigabyte model cache.

This does **not** prove that the exact installed package discovers and plays through this computer's current cache. That remains an owner test. The route requires Python 3.14, `chatterbox-tts` and compatible packages, a compatible CUDA GPU/runtime, and the existing local Chatterbox cache. A computer without those dependencies truthfully remains text-only. There is no silent browser, Windows, or named-person fallback.

## Holds

- Owner install and interaction acceptance, including complete transcript, first-greeting warmup playback, speaker mute, audible reply, and exit cleanup.
- Owner acceptance of the real installed Windows Forms uninstall flow while the app is open, followed by preserve/reinstall and disposable-profile remove-all checks.
- Publisher signing.
- Independent accessibility review.
- Hack for Humanity eligibility confirmation.
- Final name, public repository, download/demo link, video, captions, owner approval, publication, and submission.
- No clinical validation, diagnosis, treatment effect, or guaranteed safety outcome is claimed.

Do not publish or submit 0.2.12 based only on this automated evidence.
