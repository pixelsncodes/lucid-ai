"""Tests that the /stt endpoint passes vad_filter=True to faster-whisper."""
import sys
import os
from unittest.mock import MagicMock, patch
from io import BytesIO

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
from main import app


def test_stt_transcribe_passes_vad_filter():
    mock_segment = MagicMock()
    mock_segment.text = "hello"
    mock_model = MagicMock()
    mock_model.transcribe.return_value = (iter([mock_segment]), MagicMock())

    with patch("main.get_stt_model", return_value=mock_model):
        client = TestClient(app)
        response = client.post(
            "/stt",
            files={"audio": ("recording.webm", BytesIO(b"fake"), "audio/webm")},
        )

    assert response.status_code == 200
    mock_model.transcribe.assert_called_once()
    _, kwargs = mock_model.transcribe.call_args
    assert kwargs.get("vad_filter") is True
