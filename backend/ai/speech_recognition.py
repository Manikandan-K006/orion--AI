def transcribe_audio(audio_path: str) -> dict:
    return {
        "audio_path": audio_path,
        "transcript": "",
        "message": "Connect Whisper model here for production audio transcription",
    }
