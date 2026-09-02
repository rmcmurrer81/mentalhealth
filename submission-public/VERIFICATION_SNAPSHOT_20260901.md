# Verification snapshot — 2026-09-01

## Environment

- Node.js: 24.15.0
- pnpm: 11.19.0
- Branch: `main`
- Configured remote: `https://github.com/rmcmurrer81/mentalhealth.git`
- Candidate record: Wellbeing Companion 0.2.25

## Reproduced in this submission audit

| Check | Result |
|---|---|
| Source tests | **PASS — 1,733/1,733 in 41/41 files** |
| TypeScript + Vite production build | **PASS** |
| Desktop JavaScript and PowerShell syntax | **PASS** |
| Desktop tests | **PASS — 81/81** |

An earlier attempt encountered `EADDRINUSE` because the installed app still owned
the fixed loopback port. After the port was confirmed free, the complete desktop suite
was rerun and passed 81/81. The earlier environmental collision is not counted as a
current product failure.

## Existing candidate evidence

`verification/AUTOMATED_CANDIDATE_STATUS_0.2.25_20260901.md` records:

- exact package archive:
  `Wellbeing-Companion-Working-Title-Setup-0.2.25-win32-x64.zip`;
- bytes: `151064373`;
- SHA-256:
  `B8BD41EC9BFEDE4C639EB8189E35215C43819950EDAE0FD740FE7E3387E9F230`;
- unsigned owner-test setup launcher;
- 1,733/1,733 source tests;
- 280/280 synthetic conversation-quality checks;
- 81/81 desktop tests in that recorded candidate run;
- exact-package voice, speech, onboarding, startup-smoke, package verification, and
  isolated-lifecycle passes.

This audit did not independently rerun the heavyweight package probes. The record is
evidence, not a new result from this documentation task.

## Submission blockers

- Written organizer eligibility confirmation for AI coding assistance is not present.
- Owner visual, conversational, and real-installer acceptance is not complete.
- The current visual companion is a temporary animated orb, not true 3D.
- The installer is unsigned.
- No hosted or downloadable public judge URL is verified.
- The final native screenshots and captioned demo video do not exist.
- Automated and synthetic evaluation is not clinical validation.

## Current publication decision

The owner authorized publication of the reviewed current source and this public
submission packet to the configured GitHub repository. Local profiles, caches,
temporary speech probes, unsigned release archives, historical owner captures, and
private verification receipts remain excluded. Devpost submission and public binary
distribution remain **HOLD**.
