import logging
import os
import traceback

logger = logging.getLogger("speaksense.speech")

_MODEL = None


def _load_model():
    global _MODEL
    if _MODEL is None:
        try:
            from faster_whisper import WhisperModel

            # "base" is a good balance of speed/accuracy. "tiny"/"small" are faster.
            _MODEL = WhisperModel("base", device="cpu", compute_type="int8")
        except Exception as exc:  # pragma: no cover - environment issue
            logger.error("Failed to load Faster-Whisper model:\n%s", traceback.format_exc())
            raise
    return _MODEL


def transcribe_audio(audio_path: str) -> dict:
    if not audio_path or not os.path.exists(audio_path):
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": "Audio file not found.",
        }
    try:
        model = _load_model()
        segments, _info = model.transcribe(audio_path, language="en", beam_size=5)
        transcript = "".join(seg.text for seg in segments).strip()

        if transcript:
            return {
                "audio_path": audio_path,
                "transcript": transcript,
                "message": "Transcription completed using Faster-Whisper",
                "success": True,
            }
        return {
            "audio_path": audio_path,
            "transcript": "",
            "message": "Whisper returned an empty transcript. Check audio clarity.",
            "success": True,
        }
    except Exception as exc:
        # Log the full traceback server-side only; never leak internals to clients.
        logger.error("Speech recognition failed:\n%s", traceback.format_exc())
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": "Speech recognition service unavailable.",
        }
