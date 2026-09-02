"""Bounded offline Chatterbox voice host for the Wellbeing Companion.

The host binds only to 127.0.0.1 on an ephemeral port, requires a per-process
bearer token, accepts a fixed schema with small request caps, and never downloads
models. It uses only the two project-owned synthetic reference samples whose
provenance is recorded beside the files in the packaged web assets.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
import winsound

CATALOG_SCHEMA = "wellbeing.chatterbox.host-ready.v1"
REQUEST_SCHEMA = "wellbeing.local-voice.provider-request.v1"
RESULT_SCHEMA = "wellbeing.local-voice.provider-result.v1"
CANCEL_RESULT_SCHEMA = "wellbeing.local-voice.cancel-result.v1"
PLAYBACK_SCHEMA = "wellbeing.local-voice.playback-start.v1"
PLAYBACK_PREFIX = "WELLBEING_VOICE_PLAYBACK "
MAX_REQUEST_BYTES = 2_048
MAX_TEXT_CHARS = 220
PROFILE_CONFIG = {
    "soft-feminine": {
        "selector": "calm-female.owner-approved.v1",
        "reference": "calm-female-approved.wav",
        "sha256": "c3e3682817476212c990969901028758fbbde1eb4eb8c97153ef878b3939b33a",
        "exaggeration": 0.34,
        "cfg_weight": 0.56,
        "temperature": 0.70,
    },
    "calm-masculine": {
        "selector": "warm-male.owner-approved.v1",
        "reference": "warm-male-approved.wav",
        "sha256": "0a8cdb8178bf56a6aa2442cca496dcf87a76b52e8eb0743488dc5f0e8c8a8a8e",
        "exaggeration": 0.30,
        "cfg_weight": 0.58,
        "temperature": 0.68,
    },
}


def text_viseme(character: str) -> str:
    lowered = character.lower()
    if lowered in "mbp":
        return "lip-contact"
    if lowered in "ouwq":
        return "rounded"
    if lowered in "eiyszx":
        return "wide"
    if lowered.isalpha() or lowered.isdigit():
        return "jaw-open"
    return "rest"


def playback_timing(request_id: str, text: str, samples, sample_rate: int) -> dict[str, object]:
    """Return privacy-minimized, waveform-aligned animation timing.

    Amplitude levels are measured from the generated waveform. Mouth classes
    are text-class heuristics distributed across that exact waveform duration;
    this deliberately does not claim forced phoneme alignment.
    """
    import numpy as np  # type: ignore

    flattened = np.asarray(samples, dtype=np.float32).reshape(-1)
    duration_ms = max(100, int(round(len(flattened) * 1000 / sample_rate)))
    window_samples = max(1, int(sample_rate * 0.08))
    rms_values = [
        float(np.sqrt(np.mean(np.square(flattened[start:start + window_samples], dtype=np.float64))))
        for start in range(0, len(flattened), window_samples)
    ][:500]
    peak_rms = max(rms_values or [1.0]) or 1.0
    amplitudes = [
        {"startMs": index * 80, "level": round(min(1.0, value / peak_rms), 3)}
        for index, value in enumerate(rms_values)
    ]
    characters = [character for character in text if not character.isspace()] or ["."]
    unit = duration_ms / len(characters)
    cues: list[dict[str, object]] = []
    for index, character in enumerate(characters):
        start_ms = int(round(index * unit))
        end_ms = duration_ms if index == len(characters) - 1 else max(start_ms + 1, int(round((index + 1) * unit)))
        viseme = text_viseme(character)
        if cues and cues[-1]["viseme"] == viseme and cues[-1]["endMs"] == start_ms:
            cues[-1]["endMs"] = end_ms
        else:
            cues.append({"startMs": start_ms, "endMs": end_ms, "viseme": viseme})
    return {
        "schema": PLAYBACK_SCHEMA,
        "requestId": request_id,
        "durationMs": duration_ms,
        "timingBasis": "generated-waveform-amplitude-plus-text-class-heuristic",
        "amplitudeFrames": amplitudes,
        "visemeCues": cues,
    }


def exact_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_reference_root(reference_root: Path) -> dict[str, Path]:
    root = reference_root.resolve(strict=True)
    if not root.is_dir():
        raise RuntimeError("The packaged synthetic voice reference directory is missing.")
    result: dict[str, Path] = {}
    for profile, config in PROFILE_CONFIG.items():
        candidate = (root / config["reference"]).resolve(strict=True)
        if candidate.parent != root or not candidate.is_file():
            raise RuntimeError("A packaged synthetic voice reference is outside its fixed directory.")
        if exact_sha256(candidate) != config["sha256"]:
            raise RuntimeError("A packaged synthetic voice reference failed its integrity check.")
        result[profile] = candidate
    return result


def load_chatterbox(reference_root: Path):
    # Chatterbox 0.1.7 expects librosa.resample at module scope. Librosa 0.11
    # exposes the same implementation under librosa.core.audio. This local alias
    # avoids modifying either installed package.
    import librosa  # type: ignore
    from librosa.core.audio import resample  # type: ignore

    librosa.resample = resample

    import torch  # type: ignore
    from chatterbox.tts import ChatterboxTTS  # type: ignore

    if not torch.cuda.is_available():
        raise RuntimeError("The installed Chatterbox route requires a compatible CUDA GPU on this device.")
    references = validate_reference_root(reference_root)
    model = ChatterboxTTS.from_pretrained("cuda")
    conditions = {}
    for profile, reference in references.items():
        model.prepare_conditionals(str(reference), exaggeration=PROFILE_CONFIG[profile]["exaggeration"])
        conditions[profile] = model.conds
    return model, conditions


class VoiceState:
    def __init__(self, model, conditions: dict[str, object], runtime_root: Path):
        self.model = model
        self.conditions = conditions
        self.runtime_root = runtime_root
        self.generate_lock = threading.Lock()
        self.cancel_lock = threading.Lock()
        self.phase_lock = threading.Lock()
        self.cancel_generation = 0
        self.active_request_id: str | None = None
        self.active_phase = "idle"

    @staticmethod
    def stop_playback() -> bool:
        # SND_PURGE is not implemented consistently on current Windows builds.
        # Passing None with zero flags is the documented general stop path, so
        # try both and treat either successful call as a completed stop request.
        for flags in (getattr(winsound, "SND_PURGE", 0), 0):
            try:
                winsound.PlaySound(None, flags)
                return True
            except (RuntimeError, OSError):
                continue
        return False

    def set_phase(self, request_id: str, phase: str) -> None:
        with self.phase_lock:
            self.active_request_id = request_id
            self.active_phase = phase

    def clear_phase(self, request_id: str) -> None:
        with self.phase_lock:
            if self.active_request_id == request_id:
                self.active_request_id = None
                self.active_phase = "idle"

    def cancel(self, request_id: str) -> tuple[bool, str]:
        with self.phase_lock:
            if self.active_request_id != request_id:
                return False, "idle"
            phase = self.active_phase
        with self.cancel_lock:
            self.cancel_generation += 1
        self.stop_playback()
        return True, phase

    def cancel_all(self) -> None:
        with self.cancel_lock:
            self.cancel_generation += 1
        self.stop_playback()

    def generation(self) -> int:
        with self.cancel_lock:
            return self.cancel_generation

    def speak(self, payload: dict[str, object]) -> bool:
        request_id = payload["requestId"]
        profile = payload["profile"]
        config = PROFILE_CONFIG[profile]
        request_generation = self.generation()
        self.set_phase(request_id, "generating")
        try:
            with self.generate_lock:
                if request_generation != self.generation():
                    return False
                self.model.conds = self.conditions[profile]
                waveform = self.model.generate(
                    payload["text"],
                    audio_prompt_path=None,
                    exaggeration=config["exaggeration"],
                    cfg_weight=config["cfg_weight"],
                    temperature=config["temperature"],
                )
                if request_generation != self.generation():
                    return False
                import soundfile as sf  # type: ignore

                descriptor, output_name = tempfile.mkstemp(prefix="wellbeing-voice-", suffix=".wav", dir=self.runtime_root)
                os.close(descriptor)
                output = Path(output_name)
                try:
                    samples = waveform.squeeze(0).detach().cpu().numpy()
                    sf.write(output, samples, self.model.sr)
                    if request_generation != self.generation():
                        return False
                    duration_seconds = max(0.1, float(samples.shape[-1]) / float(self.model.sr))
                    self.set_phase(request_id, "playing")
                    winsound.PlaySound(
                        str(output),
                        winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT,
                    )
                    if request_generation != self.generation():
                        self.stop_playback()
                        return False
                    print(PLAYBACK_PREFIX + json.dumps(
                        playback_timing(request_id, str(payload["text"]), samples, int(self.model.sr)),
                        separators=(",", ":"),
                    ), flush=True)
                    deadline = time.monotonic() + duration_seconds + 0.15
                    while time.monotonic() < deadline:
                        if request_generation != self.generation():
                            self.stop_playback()
                            return False
                        time.sleep(0.025)
                    self.stop_playback()
                    return request_generation == self.generation()
                finally:
                    self.stop_playback()
                    output.unlink(missing_ok=True)
        finally:
            self.clear_phase(request_id)


def clean_text(value: object) -> str:
    if not isinstance(value, str) or not value or value.strip() != value or len(value) > MAX_TEXT_CHARS:
        raise ValueError("invalid text")
    if any(ord(character) < 32 or character in "\u007f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069" for character in value):
        raise ValueError("invalid text")
    return value


def validate_request(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != {"schema", "requestId", "text", "profile", "selectorId", "locale"}:
        raise ValueError("invalid schema")
    if value["schema"] != REQUEST_SCHEMA:
        raise ValueError("invalid schema")
    request_id = value["requestId"]
    profile = value["profile"]
    locale = value["locale"]
    if not isinstance(request_id, str) or not request_id or len(request_id) > 64 or not all(character.isalnum() or character in "_-" for character in request_id):
        raise ValueError("invalid request id")
    if profile not in PROFILE_CONFIG or value["selectorId"] != PROFILE_CONFIG[profile]["selector"]:
        raise ValueError("invalid profile")
    if locale != "en-US":
        raise ValueError("unsupported locale")
    return {
        "schema": REQUEST_SCHEMA,
        "requestId": request_id,
        "text": clean_text(value["text"]),
        "profile": profile,
        "selectorId": value["selectorId"],
        "locale": locale,
    }


def result(request_id: str, status: str, playback_confirmed: bool) -> dict[str, object]:
    return {
        "schema": RESULT_SCHEMA,
        "requestId": request_id,
        "status": status,
        "playbackConfirmed": playback_confirmed,
    }


def make_handler(auth_token: str, state: VoiceState):
    class Handler(BaseHTTPRequestHandler):
        server_version = "WellbeingLocalVoice/1"
        sys_version = ""

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def authenticated(self) -> bool:
            expected = f"Bearer {auth_token}"
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(expected.encode("utf-8"), supplied.encode("utf-8"))

        def send_json(self, status_code: int, value: dict[str, object]) -> None:
            body = json.dumps(value, separators=(",", ":")).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.client_address[0] != "127.0.0.1" or not self.authenticated():
                self.send_json(403, {"status": "denied"})
                return
            if urllib.parse.urlsplit(self.path).path != "/status":
                self.send_json(404, {"status": "not-found"})
                return
            self.send_json(200, {"schema": CATALOG_SCHEMA, "ready": True, "profiles": list(PROFILE_CONFIG)})

        def do_POST(self) -> None:
            if self.client_address[0] != "127.0.0.1" or not self.authenticated():
                self.send_json(403, {"status": "denied"})
                return
            route = urllib.parse.urlsplit(self.path).path
            content_length = self.headers.get("Content-Length", "")
            if not content_length.isdigit() or int(content_length) < 2 or int(content_length) > MAX_REQUEST_BYTES:
                self.send_json(413, {"status": "invalid-request"})
                return
            try:
                value = json.loads(self.rfile.read(int(content_length)).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.send_json(400, {"status": "invalid-request"})
                return
            if route == "/cancel":
                if not isinstance(value, dict) or set(value) != {"requestId"}:
                    self.send_json(400, {"status": "invalid-request"})
                    return
                request_id = value["requestId"]
                if not isinstance(request_id, str) or not request_id or len(request_id) > 64 or not all(character.isalnum() or character in "_-" for character in request_id):
                    self.send_json(400, {"status": "invalid-request"})
                    return
                accepted, active_phase = state.cancel(request_id)
                self.send_json(200, {
                    "schema": CANCEL_RESULT_SCHEMA,
                    "requestId": request_id,
                    "status": "cancelled" if accepted else "not-active",
                    "activePhase": active_phase,
                })
                return
            if route != "/speak":
                self.send_json(404, {"status": "not-found"})
                return
            try:
                request = validate_request(value)
                completed = state.speak(request)
                self.send_json(200, result(request["requestId"], "completed" if completed else "failed", completed))
            except ValueError:
                request_id = value.get("requestId", "invalid") if isinstance(value, dict) else "invalid"
                self.send_json(400, result(str(request_id)[:64] or "invalid", "failed", False))
            except Exception:
                request_id = value.get("requestId", "failed") if isinstance(value, dict) else "failed"
                self.send_json(500, result(str(request_id)[:64] or "failed", "failed", False))

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--reference-root", required=True)
    parser.add_argument("--runtime-root", required=True)
    arguments = parser.parse_args()
    token = os.environ.get("WELLBEING_VOICE_AUTH_TOKEN", "")
    if len(token) != 64 or any(character not in "0123456789abcdef" for character in token):
        raise RuntimeError("The local voice host authentication token is invalid.")
    runtime_root = Path(arguments.runtime_root).resolve()
    runtime_root.mkdir(parents=True, exist_ok=True)
    model, conditions = load_chatterbox(Path(arguments.reference_root))
    state = VoiceState(model, conditions, runtime_root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(token, state))
    server.daemon_threads = True
    port = server.server_address[1]
    print("WELLBEING_VOICE_READY " + json.dumps({
        "schema": CATALOG_SCHEMA,
        "port": port,
        "profiles": list(PROFILE_CONFIG),
        "localOnly": True,
        "modelBundled": False,
    }, separators=(",", ":")), flush=True)

    def stop_server(_signal=None, _frame=None):
        state.cancel_all()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    signal.signal(signal.SIGINT, stop_server)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        state.cancel_all()
        for candidate in runtime_root.glob("wellbeing-voice-*.wav"):
            candidate.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("WELLBEING_VOICE_ERROR " + json.dumps({
            "schema": "wellbeing.chatterbox.host-error.v1",
            "errorType": type(error).__name__,
            "message": str(error)[:300],
        }, separators=(",", ":")), file=sys.stderr, flush=True)
        raise SystemExit(1)
