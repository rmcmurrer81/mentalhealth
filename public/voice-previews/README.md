# Approved local voice previews

These are short, original synthesized previews made from the official built-in
voice packs in `hexgrad/Kokoro-82M` at pinned revision
`f3ff3571791e39611d31c381e3a41a3af07b4987`.

- `calm-female-approved.wav` uses built-in voice `af_heart`.
- `warm-male-approved.wav` uses built-in voice `am_fenrir`.

The application binds those two approvals to the product-level selectors
`calm-female.owner-approved.v1` and `warm-male.owner-approved.v1`. The desktop
broker inserts the selector after the renderer boundary; an unapproved or
future preset remains text-only and cannot be substituted silently. These
selector names are not model IDs and do not expose a generated-audio path.

The product owner approved the sound of these exact samples for starter
hackathon use. They are not recordings or imitations of a named person, do not
assign a voice to a KiraWorld resident, and do not prove that dynamic local
synthesis is installed or active. The application plays them only after a user
presses the preview button. Generated replies stay text-only until the separate
reviewed local provider is genuinely ready.

Kokoro code, model, and built-in voice packs are identified upstream as
Apache-2.0. Model weights, caches, Python environments, and private reference
recordings are not bundled here.
