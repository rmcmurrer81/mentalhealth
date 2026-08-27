'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createChatterboxLocalVoiceProvider,
} = require('../desktop/chatterbox-local-voice.cjs');

const PROVIDER_REQUEST_SCHEMA = 'wellbeing.local-voice.provider-request.v1';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const desktopRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(desktopRoot, 'verification', 'chatterbox-probe-runtime');
  const referenceRoot = path.resolve(desktopRoot, '..', 'public', 'voice-previews');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const startedAt = Date.now();
  const provider = createChatterboxLocalVoiceProvider({ runtimeRoot, referenceRoot });
  try {
    let state = await provider.status();
    while (!state.ready && Date.now() - startedAt < 50_000) {
      await wait(500);
      state = await provider.status();
    }
    if (!state.ready) throw new Error('The bounded local voice host did not become ready in 50 seconds.');
    const readyMilliseconds = Date.now() - startedAt;
    const speakStartedAt = Date.now();
    const result = await provider.speak({
      schema: PROVIDER_REQUEST_SCHEMA,
      requestId: 'owner-audible-probe-1',
      text: 'I am listening. Take your time.',
      profile: 'soft-feminine',
      selectorId: 'calm-female.owner-approved.v1',
      locale: 'en-US',
    });
    if (result.status !== 'completed' || result.playbackConfirmed !== true) {
      throw new Error(`The local voice probe did not confirm playback (${result.status}).`);
    }
    process.stdout.write(`${JSON.stringify({
      schema: 'wellbeing.chatterbox.audible-probe.v1',
      status: 'PASS',
      localOnly: true,
      modelBundled: false,
      profile: 'soft-feminine',
      playbackConfirmed: true,
      readyMilliseconds,
      speakMilliseconds: Date.now() - speakStartedAt,
    }, null, 2)}\n`);
  } finally {
    provider.dispose();
  }
}

main().catch((error) => {
  process.stderr.write(`WELLBEING_CHATTERBOX_PROBE_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
