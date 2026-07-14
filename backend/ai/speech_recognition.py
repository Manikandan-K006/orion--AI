import os


def transcribe_audio(audio_path: str) -> dict:
    try:
        import whisper
        model = whisper.load_model("base")
        result = model.transcribe(audio_path, language="en")
        transcript = result.get("text", "").strip()
        if transcript:
            return {
                "audio_path": audio_path,
                "transcript": transcript,
                "message": "Transcription completed using Whisper",
            }
        return {
            "audio_path": audio_path,
            "transcript": "",
            "message": "Whisper returned empty transcript. Check audio clarity.",
        }
    except Exception as exc:
        return {
            "audio_path": audio_path,
            "transcript": "",
            "message": f"Whisper transcription failed: {exc}",
        }
