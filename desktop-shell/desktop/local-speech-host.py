"""Memory-only, cache-only speech input host for Wellbeing Companion.

The host binds to loopback on an ephemeral port, requires a per-launch bearer
token, accepts one bounded recording at a time, and never writes microphone
audio or transcript files. The ASR model must already exist in the local
Hugging Face cache; network/model downloads are disabled by the launcher.
"""

from __future__ import annotations

import argparse
import hmac
import io
import json
import os
from pathlib import Path
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse

READY_SCHEMA = "wellbeing.local-speech.host-ready.v1"
RESULT_SCHEMA = "wellbeing.local-speech.provider-result.v1"
MAX_AUDIO_BYTES = 12 * 1024 * 1024
MAX_TRANSCRIPT_CHARS = 2_000
ALLOWED_TYPES = {"audio/webm", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4"}
MODEL_ID = "Systran/faster-whisper-small.en"


def cached_model_path() -> Path | None:
    explicit = os.environ.get("WELLBEING_ASR_MODEL_PATH", "").strip()
    root = Path(explicit).expanduser() if explicit else (
        Path.home() / ".cache" / "huggingface" / "hub" / "models--Systran--faster-whisper-small.en"
    )
    if (root / "model.bin").is_file():
        return root.resolve()
    snapshots = root / "snapshots"
    if not snapshots.is_dir():
        return None
    candidates = sorted(item.resolve() for item in snapshots.iterdir() if item.is_dir() and (item / "model.bin").is_file())
    return candidates[-1] if candidates else None


def load_model():
    model_path = cached_model_path()
    if model_path is None:
        raise RuntimeError("The reviewed cache-only speech recognition model is unavailable.")
    from faster_whisper import WhisperModel  # type: ignore

    return WhisperModel(str(model_path), device="cpu", compute_type="int8")


def clean_transcript(value: str) -> str:
    cleaned = " ".join(value.replace("\x00", " ").split()).strip()
    return cleaned[:MAX_TRANSCRIPT_CHARS]


def transcribe(model, audio: bytes, request_id: str) -> dict[str, object]:
    segments, info = model.transcribe(
        io.BytesIO(audio),
        language="en",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        temperature=0.0,
    )
    text = clean_transcript(" ".join(str(getattr(segment, "text", "")).strip() for segment in segments))
    return {
        "schema": RESULT_SCHEMA,
        "requestId": request_id,
        "status": "completed",
        "text": text,
        "language": str(getattr(info, "language", "en"))[:8] or "en",
        "rawAudioPersisted": False,
    }


def valid_request_id(value: str) -> bool:
    return bool(value) and len(value) <= 64 and all(character.isalnum() or character in "_-" for character in value)


def make_handler(token: str, model, transcribe_lock: threading.Lock):
    class Handler(BaseHTTPRequestHandler):
        server_version = "WellbeingLocalSpeech/1"
        sys_version = ""

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def send_json(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self) -> bool:
            expected = f"Bearer {token}".encode("utf-8")
            supplied = self.headers.get("Authorization", "").encode("utf-8")
            return hmac.compare_digest(expected, supplied)

        def do_POST(self) -> None:
            if self.client_address[0] != "127.0.0.1" or not self.authorized():
                self.send_json(403, {"status": "denied"})
                return
            if urllib.parse.urlsplit(self.path).path != "/transcribe":
                self.send_json(404, {"status": "not-found"})
                return
            request_id = self.headers.get("X-Wellbeing-Request-Id", "")
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            length_text = self.headers.get("Content-Length", "")
            if not valid_request_id(request_id) or content_type not in ALLOWED_TYPES or not length_text.isdigit():
                self.send_json(400, {"status": "invalid-request"})
                return
            length = int(length_text)
            if length < 1 or length > MAX_AUDIO_BYTES:
                self.send_json(413, {"status": "invalid-size"})
                return
            audio = self.rfile.read(length)
            if len(audio) != length or not transcribe_lock.acquire(blocking=False):
                self.send_json(409, {"status": "busy"})
                return
            try:
                self.send_json(200, transcribe(model, audio, request_id))
            except Exception:
                self.send_json(422, {
                    "schema": RESULT_SCHEMA,
                    "requestId": request_id,
                    "status": "failed",
                    "text": "",
                    "language": "en",
                    "rawAudioPersisted": False,
                })
            finally:
                audio = b""
                transcribe_lock.release()

    return Handler


def main() -> int:
    argparse.ArgumentParser(add_help=False).parse_args()
    token = os.environ.get("WELLBEING_ASR_AUTH_TOKEN", "")
    if len(token) != 64 or any(character not in "0123456789abcdef" for character in token):
        raise RuntimeError("The local speech host authentication token is invalid.")
    model = load_model()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(token, model, threading.Lock()))
    server.daemon_threads = True
    print("WELLBEING_ASR_READY " + json.dumps({
        "schema": READY_SCHEMA,
        "port": server.server_address[1],
        "localOnly": True,
        "cacheOnly": True,
        "rawAudioPersisted": False,
    }, separators=(",", ":")), flush=True)

    def stop_server(_signal=None, _frame=None):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    signal.signal(signal.SIGINT, stop_server)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("WELLBEING_ASR_ERROR " + json.dumps({
            "schema": "wellbeing.local-speech.host-error.v1",
            "errorType": type(error).__name__,
            "message": str(error)[:240],
        }, separators=(",", ":")), file=os.sys.stderr, flush=True)
        raise SystemExit(1)
