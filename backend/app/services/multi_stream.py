import json
from pathlib import Path
import shutil
import time
import uuid

from fastapi import HTTPException
from google.auth.transport.requests import AuthorizedSession
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MediaFile
from app.services.google_drive import (
    create_resumable_upload_session,
    get_drive_file,
    get_google_credentials,
)


BASE_DIR = Path(__file__).resolve().parents[2]
STAGING_BASE_DIR = BASE_DIR / "staging"
STAGING_BASE_DIR.mkdir(parents=True, exist_ok=True)

CHUNK_ALIGNMENT = 256 * 1024  # 262,144 bytes (Google Drive API requirement)


def init_multi_stream_session(
    user_id: int,
    filename: str,
    mime_type: str,
    size_bytes: int,
    num_parts: int,
    target_folder_id: str,
) -> dict:
    session_id = uuid.uuid4().hex
    staging_dir = STAGING_BASE_DIR / session_id
    staging_dir.mkdir(parents=True, exist_ok=True)

    # Pre-create Google Drive resumable session for master file
    upload_url = create_resumable_upload_session(
        filename=filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        parent_folder_id=target_folder_id,
    )

    # Calculate part_size aligned to 256 KiB
    raw_part_size = size_bytes // num_parts
    aligned_part_size = ((raw_part_size + CHUNK_ALIGNMENT - 1) // CHUNK_ALIGNMENT) * CHUNK_ALIGNMENT
    if aligned_part_size < CHUNK_ALIGNMENT:
        aligned_part_size = CHUNK_ALIGNMENT

    # Actual number of parts based on aligned part size
    actual_num_parts = (size_bytes + aligned_part_size - 1) // aligned_part_size
    if actual_num_parts < 1:
        actual_num_parts = 1

    metadata = {
        "session_id": session_id,
        "user_id": user_id,
        "filename": filename,
        "mime_type": mime_type,
        "size_bytes": size_bytes,
        "num_parts": actual_num_parts,
        "part_size": aligned_part_size,
        "target_folder_id": target_folder_id,
        "upload_url": upload_url,
        "created_at": time.time(),
    }

    (staging_dir / "meta.json").write_text(
        json.dumps(metadata),
        encoding="utf-8",
    )

    return {
        "session_id": session_id,
        "num_parts": actual_num_parts,
        "part_size": aligned_part_size,
        "size_bytes": size_bytes,
        "filename": filename,
    }


def save_part_chunk(
    session_id: str,
    part_index: int,
    file_bytes: bytes,
) -> int:
    staging_dir = STAGING_BASE_DIR / session_id
    if not staging_dir.exists():
        raise HTTPException(status_code=404, detail="Upload staging session not found.")

    part_file = staging_dir / f"part_{part_index}"
    with open(part_file, "wb") as f:
        f.write(file_bytes)

    return len(file_bytes)


def complete_multi_stream_session(
    session_id: str,
    db: Session,
) -> dict:
    staging_dir = STAGING_BASE_DIR / session_id
    meta_file = staging_dir / "meta.json"

    if not staging_dir.exists() or not meta_file.exists():
        raise HTTPException(status_code=404, detail="Upload staging session not found.")

    metadata = json.loads(meta_file.read_text(encoding="utf-8"))
    num_parts = metadata["num_parts"]
    size_bytes = metadata["size_bytes"]
    filename = metadata["filename"]
    mime_type = metadata["mime_type"]
    upload_url = metadata["upload_url"]
    user_id = metadata["user_id"]
    target_folder_id = metadata["target_folder_id"]

    # Verify all parts exist and total size matches exactly
    total_staged_bytes = 0
    for i in range(num_parts):
        part_file = staging_dir / f"part_{i}"
        if not part_file.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Missing upload part {i + 1} of {num_parts}.",
            )
        total_staged_bytes += part_file.stat().st_size

    if total_staged_bytes != size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Staged size ({total_staged_bytes}) does not match expected size ({size_bytes}).",
        )

    # Stream all parts sequentially into Google Drive's resumable session URL
    credentials = get_google_credentials()
    session = AuthorizedSession(credentials)

    offset = 0
    drive_file_id = None

    try:
        for i in range(num_parts):
            part_file = staging_dir / f"part_{i}"
            part_size = part_file.stat().st_size
            part_end = offset + part_size - 1

            headers = {
                "Content-Length": str(part_size),
                "Content-Range": f"bytes {offset}-{part_end}/{size_bytes}",
                "Content-Type": mime_type,
            }

            with open(part_file, "rb") as f:
                res = session.put(
                    upload_url,
                    headers=headers,
                    data=f,
                    timeout=300,
                )

            offset += part_size

            if res.status_code in (200, 201):
                data = res.json()
                drive_file_id = data.get("id")
            elif res.status_code != 308:
                raise HTTPException(
                    status_code=502,
                    detail=f"Google Drive upload failed at part {i}: {res.text}",
                )

        if not drive_file_id:
            raise HTTPException(
                status_code=502,
                detail="Google Drive did not return file ID after completing all parts.",
            )

        # Verify Drive file
        drive_file = get_drive_file(drive_file_id)
        if int(drive_file.get("size", 0)) != size_bytes:
            raise HTTPException(
                status_code=502,
                detail="Google Drive stored file size mismatch.",
            )

        # Create database record
        media_file = MediaFile(
            owner_id=user_id,
            name=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            google_drive_file_id=drive_file_id,
            google_drive_folder_id=target_folder_id,
        )
        db.add(media_file)
        db.commit()
        db.refresh(media_file)

        return {
            "message": "Turbo 6-stream upload completed successfully.",
            "id": media_file.id,
            "google_drive_file_id": drive_file_id,
            "name": media_file.name,
            "size_bytes": media_file.size_bytes,
        }

    finally:
        # Clean up staging directory immediately
        shutil.rmtree(staging_dir, ignore_errors=True)
