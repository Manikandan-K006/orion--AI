$env:FFMPEG_PATH = "C:\Users\manii\OneDrive\Desktop\speaksense-ai-orion\ffmpeg.exe"
Set-Location "C:\Users\manii\OneDrive\Desktop\speaksense-ai-orion"
& "backend\venv\Scripts\python.exe" -m uvicorn backend.main:app --port 8000 --reload
