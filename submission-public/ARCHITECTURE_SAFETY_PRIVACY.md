# Architecture, safety, and privacy

## System boundary

```text
React / TypeScript UI and PWA
        |
        +--> deterministic conversation, memory, reminder, and safety core
        |        |
        |        +--> device-local profile
        |        +--> optional PBKDF2 + AES-GCM vault
        |        +--> separated primary and guardian roles
        |
        +--> optional allowlisted Ollama wording
                 ordinary steady replies only, fixed 127.0.0.1 boundary

Electron Windows shell
        |
        +--> fixed loopback renderer origin and narrow preload API
        +--> optional authenticated local Chatterbox output broker
        +--> optional authenticated cache-only faster-whisper input broker
        +--> native window, tray, permissions, mute, lock, and teardown lifecycle
```

## Protected decision routes

The optional local model does not own:

- self-harm or suicide-related safety behavior;
- acute medical or poisoning/overdose behavior;
- threats from another person;
- violence risk toward another person;
- third-party concern;
- medication dose or interaction decisions;
- diagnosis requests;
- grief and bullying boundaries.

Those routes are deterministic and testable. The app keeps the conversation visible,
offers proportionate actions, and does not turn a support option into a blocking
condition for continued chat.

## Memory controls

- New learning is on by default and can be paused.
- Saved memories are visible and individually deletable.
- Explicit corrections replace stale facts instead of creating silent duplicates.
- Fictional role-play, rehearsal dialogue, game answers, and inferred emotion are
  excluded from the personal profile.
- Pending optional-model generations are invalidated when privacy or memory state
  changes, preventing a stale reply from restoring deleted information.

## Privacy controls

- The normal profile is device-local, but not described as encrypted by default.
- The optional password vault uses PBKDF2-SHA-256 with a random salt and
  AES-256-GCM with a fresh IV for each seal.
- Primary and guardian roles are cryptographically separated.
- A lost vault password cannot be recovered by the app.
- Local microphone use requires an explicit app-session action and any required
  Windows permission.
- The installed local speech route processes bounded audio through loopback and
  discards in-memory audio after the turn; it does not promise that every machine has
  the required local model cache.
- No enabled cloud language-model transfer is claimed.

## Safety and evaluation limits

Automated tests and synthetic scenarios can show deterministic behavior for the cases
they cover. They cannot establish clinical effectiveness, diagnose a person, prove
that every possible phrase is handled correctly, or replace review by clinicians,
accessibility specialists, and people with lived experience.

The current Windows candidate is unsigned. The current companion is an animated orb,
not production-quality true 3D. Owner acceptance, organizer eligibility, public
distribution, and the finished video are still external gates.
