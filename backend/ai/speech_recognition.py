import logging
import os
import shutil
import subprocess
import traceback

logger = logging.getLogger("speaksense.speech")

_MODEL = None
_MODEL_NAME = None
_FFMPEG_PATH = None


def _get_ffmpeg_path() -> str:
    """Locate the ffmpeg binary. Checks env, PATH, bundled imageio_ffmpeg, then project root."""
    global _FFMPEG_PATH
    if _FFMPEG_PATH and os.path.isfile(_FFMPEG_PATH):
        return _FFMPEG_PATH

    # 1. Environment variable override
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path and os.path.isfile(env_path):
        _FFMPEG_PATH = env_path
        logger.info("ffmpeg (env): %s", _FFMPEG_PATH)
        return _FFMPEG_PATH

    # 2. System PATH
    which = shutil.which("ffmpeg")
    if which:
        _FFMPEG_PATH = which
        logger.info("ffmpeg (PATH): %s", _FFMPEG_PATH)
        return _FFMPEG_PATH

    # 3. Bundled via imageio_ffmpeg
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            _FFMPEG_PATH = exe
            logger.info("ffmpeg (imageio): %s", _FFMPEG_PATH)
            return _FFMPEG_PATH
    except Exception:
        pass

    # 4. Project root fallback
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    for name in ("ffmpeg.exe", "ffmpeg"):
        candidate = os.path.join(project_root, name)
        if os.path.isfile(candidate):
            _FFMPEG_PATH = candidate
            logger.info("ffmpeg (project root): %s", _FFMPEG_PATH)
            return _FFMPEG_PATH

    logger.error("ffmpeg NOT FOUND — transcription will fail")
    return "ffmpeg"


def _get_model_name() -> str:
    """Return the Whisper model name from environment or default to 'base'.

    Set WHISPER_MODEL env var to 'tiny', 'base', 'small', or 'medium'.
    'tiny' is fastest on low-end CPUs; 'base' balances speed/accuracy.
    """
    return os.environ.get("WHISPER_MODEL", "base").strip().lower() or "base"


def _load_model():
    global _MODEL, _MODEL_NAME
    target = _get_model_name()
    if _MODEL is not None and _MODEL_NAME == target:
        return _MODEL
    try:
        from faster_whisper import WhisperModel

        logger.info("Loading Whisper model: %s", target)
        _MODEL = WhisperModel(target, device="cpu", compute_type="int8")
        _MODEL_NAME = target
        logger.info("Whisper model '%s' loaded.", target)
    except Exception as exc:  # pragma: no cover - environment issue
        logger.error("Failed to load Faster-Whisper model:\n%s", traceback.format_exc())
        raise
    return _MODEL


def warmup_model():
    """Pre-load Whisper model at startup so the first request is fast."""
    logger.info("Warming up Whisper model...")
    _get_ffmpeg_path()
    _load_model()
    logger.info("Whisper model loaded.")


def preprocess_audio(input_path: str) -> str:
    """Convert audio to mono 16kHz WAV and trim silence for faster Whisper processing.
    Returns the path to the preprocessed file."""
    base, ext = os.path.splitext(input_path)
    output_path = base + "_preprocessed.wav"
    ffmpeg = _get_ffmpeg_path()
    try:
        subprocess.run(
            [
                ffmpeg, "-y", "-i", input_path,
                "-ac", "1",           # mono
                "-ar", "16000",       # 16kHz
                "-af", "silenceremove=start=0:stop=0:start_threshold=-50dB:stop_threshold=-50dB:start_silence=0.5:stop_silence=1.0",
                "-f", "wav",
                output_path,
            ],
            capture_output=True, timeout=30,
        )
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info("ffmpeg preprocessed: %s -> %s (%d bytes)", input_path, output_path, os.path.getsize(output_path))
            return output_path
        else:
            logger.warning("ffmpeg produced empty output for %s", input_path)
    except FileNotFoundError:
        logger.error("ffmpeg binary not found at: %s", ffmpeg)
    except Exception as exc:
        logger.warning("Audio preprocessing failed for %s: %s", input_path, exc)
    return input_path


def transcribe_audio(audio_path: str, preprocess: bool = True) -> dict:
    if not audio_path or not os.path.exists(audio_path):
        logger.error("transcribe_audio: file not found: %s", audio_path)
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": "Audio file not found.",
        }
    file_size = os.path.getsize(audio_path)
    logger.info("transcribe_audio: %s (%d bytes, preprocess=%s)", audio_path, file_size, preprocess)
    try:
        process_path = preprocess_audio(audio_path) if preprocess else audio_path

        model = _load_model()
        logger.info("transcribe_audio: calling Whisper on %s", process_path)
        segments, _info = model.transcribe(process_path, language="en", beam_size=5)
        transcript = "".join(seg.text for seg in segments).strip()
        logger.info("transcribe_audio: Whisper returned %d chars", len(transcript))

        if preprocess and process_path != audio_path:
            try:
                os.remove(process_path)
            except Exception:
                pass

        if transcript:
            return {
                "audio_path": audio_path,
                "transcript": transcript,
                "message": f"Transcription completed using Faster-Whisper ({_MODEL_NAME or 'base'})",
                "success": True,
            }
        return {
            "audio_path": audio_path,
            "transcript": "",
            "message": "Whisper returned an empty transcript. Check audio clarity.",
            "success": True,
        }
    except Exception as exc:
        logger.warning("Whisper speech recognition failed: %s\n%s", exc, traceback.format_exc())
        return {
            "audio_path": audio_path,
            "transcript": "",
            "message": f"Speech recognition error: {exc}",
            "success": False,
        }


def transcribe_chunk(audio_path: str) -> dict:
    """Transcribe a short audio chunk (15-30 seconds) incrementally.

    Uses beam_size=1 for faster inference on CPU. Designed for
    real-time chunk processing during live GD sessions.
    """
    if not audio_path or not os.path.exists(audio_path):
        logger.error("transcribe_chunk: file not found: %s", audio_path)
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": "Audio chunk file not found.",
        }
    file_size = os.path.getsize(audio_path)
    logger.info("transcribe_chunk: %s (%d bytes)", audio_path, file_size)
    try:
        process_path = preprocess_audio(audio_path)

        model = _load_model()
        logger.info("transcribe_chunk: calling Whisper on %s", process_path)
        segments, _info = model.transcribe(
            process_path, language="en", beam_size=1,
        )
        transcript = "".join(seg.text for seg in segments).strip()
        logger.info("transcribe_chunk: Whisper returned %d chars: %s", len(transcript), transcript[:120])

        if process_path != audio_path:
            try:
                os.remove(process_path)
            except Exception:
                pass

        return {
            "audio_path": audio_path,
            "transcript": transcript,
            "success": True,
        }
    except Exception as exc:
        logger.error("transcribe_chunk FAILED for %s: %s\n%s", audio_path, exc, traceback.format_exc())
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": str(exc),
        }


def transcribe_chunk_slice(audio_path: str, start_time: float) -> dict:
    """Slice audio starting from start_time (seconds) and transcribe it using beam_size=1.

    This enables rapid progressive transcription by only transcribing the newly recorded portion.
    """
    if not audio_path or not os.path.exists(audio_path):
        logger.error("transcribe_chunk_slice: file not found: %s", audio_path)
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": "Audio file not found.",
        }

    base, ext = os.path.splitext(audio_path)
    slice_path = base + f"_slice_{int(start_time)}.wav"
    ffmpeg = _get_ffmpeg_path()

    try:
        cmd = [ffmpeg, "-y"]
        if start_time > 0.0:
            cmd.extend(["-ss", f"{start_time:.3f}"])

        cmd.extend([
            "-i", audio_path,
            "-ac", "1",
            "-ar", "16000",
            "-f", "wav",
            slice_path
        ])

        subprocess.run(cmd, capture_output=True, timeout=30)

        if not os.path.exists(slice_path) or os.path.getsize(slice_path) == 0:
            if start_time == 0.0:
                slice_path = audio_path
            else:
                logger.warning("transcribe_chunk_slice: empty slice at %.1fs", start_time)
                return {
                    "audio_path": audio_path,
                    "transcript": "",
                    "success": True,
                    "message": "Empty slice or slicing failed.",
                }

        model = _load_model()
        logger.info("transcribe_chunk_slice: calling Whisper on %s", slice_path)
        segments, _info = model.transcribe(
            slice_path, language="en", beam_size=1
        )
        transcript = "".join(seg.text for seg in segments).strip()
        logger.info("transcribe_chunk_slice: Whisper returned %d chars", len(transcript))

        if slice_path != audio_path:
            try:
                os.remove(slice_path)
            except Exception:
                pass

        return {
            "audio_path": audio_path,
            "transcript": transcript,
            "success": True,
        }
    except Exception as exc:
        logger.error("transcribe_chunk_slice FAILED for %s: %s\n%s", audio_path, exc, traceback.format_exc())
        if os.path.exists(slice_path) and slice_path != audio_path:
            try:
                os.remove(slice_path)
            except Exception:
                pass
        
        return {
            "audio_path": audio_path,
            "transcript": "",
            "success": False,
            "error": f"Transcription error: {exc}",
        }


