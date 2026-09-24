import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.multi_stream import CHUNK_ALIGNMENT


@pytest.fixture
def client():
    return TestClient(app)


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "running" in data["message"]


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_cors_headers(client):
    response = client.get("/", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers


def test_chunk_alignment_constant():
    # Google Drive resumable upload chunk alignment MUST strictly be a multiple of 256 KiB
    assert CHUNK_ALIGNMENT == 256 * 1024
    assert CHUNK_ALIGNMENT % (256 * 1024) == 0


def test_unauthenticated_protected_route(client):
    # Accessing protected routes without token must return 401
    response = client.get("/media")
    assert response.status_code == 401


def test_path_traversal_sanitization():
    from app.api.media import sanitize_and_validate_file
    from fastapi import HTTPException

    # Path traversal should be stripped to base name
    clean = sanitize_and_validate_file("/etc/secret/myfile.mp4")
    assert clean == "myfile.mp4"

    # Bare relative path traversal should raise HTTPException
    with pytest.raises(HTTPException) as exc:
        sanitize_and_validate_file("../")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        sanitize_and_validate_file("..")
    assert exc.value.status_code == 400

    # Size limit validation
    with pytest.raises(HTTPException) as exc:
        sanitize_and_validate_file("test.mp4", size_bytes=200 * 1024 * 1024 * 1024)  # 200 GB > 100 GB limit
    assert exc.value.status_code == 400
