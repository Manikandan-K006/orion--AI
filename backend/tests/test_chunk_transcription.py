import os
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.ai.speech_recognition import transcribe_chunk_slice

client = TestClient(app)

def test_transcribe_chunk_slice_invalid_path():
    # Test with non-existent path
    res = transcribe_chunk_slice("non_existent_file.wav", start_time=5.0)
    assert res["success"] is False
    assert "not found" in res["error"]

def test_upload_chunk_endpoint_no_auth():
    # Calling the endpoint without token should return 401 Unauthorized
    response = client.post("/interviews/upload-chunk", data={"start_time": 0.0})
    assert response.status_code == 401
