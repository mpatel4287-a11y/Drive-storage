import os
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    get_current_user,
    get_user_permissions_dict,
    require_permission,
)
from app.db import get_db
from app.models import MediaFile, User
from app.services.drive_setup import create_user_folder
from app.services.google_drive import (
    create_resumable_upload_session,
    delete_drive_file,
    get_drive_file,
    get_drive_file_stream,
    get_resumable_upload_status,
    list_drive_files,
    rename_drive_file,
)
from app.services.multi_stream import (
    complete_multi_stream_session,
    init_multi_stream_session,
    save_part_chunk,
)


router = APIRouter(
    prefix="/media",
    tags=["Media"],
)


# ---------------------------------------------------------
# Schemas
# ---------------------------------------------------------

class CreateUploadRequest(BaseModel):
    filename: str = Field(
        min_length=1,
        max_length=500,
    )

    mime_type: str = Field(
        min_length=1,
        max_length=255,
    )

    size_bytes: int = Field(
        gt=0,
    )

    folder_id: str | None = None


class CreateUploadResponse(BaseModel):
    upload_url: str
    filename: str
    mime_type: str
    size_bytes: int
    recommended_chunk_size: int = 8 * 1024 * 1024


class InitMultiStreamRequest(BaseModel):
    filename: str = Field(
        min_length=1,
        max_length=500,
    )
    mime_type: str = Field(
        min_length=1,
        max_length=255,
    )
    size_bytes: int = Field(
        gt=0,
    )
    num_parts: int = Field(
        default=6,
        ge=2,
        le=12,
    )
    folder_id: str | None = None


class InitMultiStreamResponse(BaseModel):
    session_id: str
    num_parts: int
    part_size: int
    size_bytes: int
    filename: str


class UploadStatusRequest(BaseModel):
    upload_url: str
    size_bytes: int = Field(
        gt=0,
    )


class UploadStatusResponse(BaseModel):
    is_complete: bool
    bytes_uploaded: int
    total_bytes: int
    file_id: str | None = None


class CompleteUploadRequest(BaseModel):
    google_drive_file_id: str
    filename: str = Field(
        min_length=1,
        max_length=500,
    )
    mime_type: str = Field(
        min_length=1,
        max_length=255,
    )
    size_bytes: int = Field(
        gt=0,
    )
    folder_id: str | None = None


class RenameMediaRequest(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=500,
    )


class MediaResponse(BaseModel):
    id: int
    name: str
    mime_type: str
    size_bytes: int
    google_drive_file_id: str
    google_drive_folder_id: str | None
    created_at: str


# ---------------------------------------------------------
# Helper validation
# ---------------------------------------------------------

def sanitize_and_validate_file(filename: str, size_bytes: int | None = None) -> str:
    clean = os.path.basename(filename).strip()
    if not clean or clean in (".", ".."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename: path traversal and empty names are not allowed.",
        )
    if size_bytes is not None and size_bytes > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size exceeds maximum allowed limit of {settings.max_upload_size_bytes} bytes.",
        )
    return clean


# ---------------------------------------------------------
# Create resumable upload session (Direct-to-Drive)
# ---------------------------------------------------------

@router.post(
    "/upload/session",
    response_model=CreateUploadResponse,
)
def create_upload_session(
    data: CreateUploadRequest,
    current_user: User = Depends(require_permission("can_upload")),
):
    clean_filename = sanitize_and_validate_file(data.filename, data.size_bytes)

    if data.folder_id:
        target_folder_id = data.folder_id
    else:
        user_folder = create_user_folder(current_user.identifier)
        target_folder_id = user_folder["id"]

    upload_url = create_resumable_upload_session(
        filename=clean_filename,
        mime_type=data.mime_type,
        size_bytes=data.size_bytes,
        parent_folder_id=target_folder_id,
    )

    return {
        "upload_url": upload_url,
        "filename": clean_filename,
        "mime_type": data.mime_type,
        "size_bytes": data.size_bytes,
        "recommended_chunk_size": 8 * 1024 * 1024,
    }


# ---------------------------------------------------------
# Multi-Stream Parallel Upload: Initialize Session
# ---------------------------------------------------------

@router.post(
    "/upload/multi-stream/init",
    response_model=InitMultiStreamResponse,
)
def init_multi_stream(
    data: InitMultiStreamRequest,
    current_user: User = Depends(require_permission("can_upload")),
):
    clean_filename = sanitize_and_validate_file(data.filename, data.size_bytes)

    if data.folder_id:
        target_folder_id = data.folder_id
    else:
        user_folder = create_user_folder(current_user.identifier)
        target_folder_id = user_folder["id"]

    return init_multi_stream_session(
        user_id=current_user.id,
        filename=clean_filename,
        mime_type=data.mime_type,
        size_bytes=data.size_bytes,
        num_parts=data.num_parts,
        target_folder_id=target_folder_id,
    )


# ---------------------------------------------------------
# Multi-Stream Parallel Upload: Ingest Stream Part
# ---------------------------------------------------------

@router.put(
    "/upload/multi-stream/{session_id}/part/{part_index}",
)
async def upload_multi_stream_part(
    session_id: str,
    part_index: int,
    request: Request,
    current_user: User = Depends(require_permission("can_upload")),
):
    body_bytes = await request.body()
    written = save_part_chunk(
        session_id=session_id,
        part_index=part_index,
        file_bytes=body_bytes,
    )
    return {
        "session_id": session_id,
        "part_index": part_index,
        "bytes_received": written,
    }


# ---------------------------------------------------------
# Multi-Stream Parallel Upload: Assemble & Finalize
# ---------------------------------------------------------

@router.post(
    "/upload/multi-stream/{session_id}/complete",
)
def complete_multi_stream(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_upload")),
):
    return complete_multi_stream_session(
        session_id=session_id,
        db=db,
    )


# ---------------------------------------------------------
# Query resumable upload status
# ---------------------------------------------------------

@router.post(
    "/upload/status",
    response_model=UploadStatusResponse,
)
def query_upload_status(
    data: UploadStatusRequest,
    current_user: User = Depends(require_permission("can_upload")),
):
    return get_resumable_upload_status(
        upload_url=data.upload_url,
        size_bytes=data.size_bytes,
    )


# ---------------------------------------------------------
# Save completed direct upload metadata
# ---------------------------------------------------------

@router.post(
    "/upload/complete",
)
def complete_upload(
    data: CompleteUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_upload")),
):
    clean_filename = sanitize_and_validate_file(data.filename, data.size_bytes)

    drive_file = get_drive_file(
        data.google_drive_file_id
    )

    if drive_file.get("trashed"):
        raise HTTPException(
            status_code=400,
            detail="The uploaded Google Drive file is in trash.",
        )

    drive_size = int(
        drive_file.get("size", 0)
    )

    if drive_size != data.size_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file size does not match the requested size.",
        )

    user_folder = create_user_folder(current_user.identifier)
    target_folder_id = data.folder_id or user_folder["id"]

    parents = drive_file.get("parents", [])
    if target_folder_id not in parents and not (current_user.is_admin or current_user.role == "manager"):
        raise HTTPException(
            status_code=403,
            detail="This file does not belong to your storage folder.",
        )

    existing = db.scalar(
        select(MediaFile).where(
            MediaFile.google_drive_file_id
            == data.google_drive_file_id
        )
    )

    if existing:
        return {
            "message": "File metadata already exists.",
            "id": existing.id,
            "google_drive_file_id": existing.google_drive_file_id,
        }

    media_file = MediaFile(
        owner_id=current_user.id,
        name=clean_filename,
        mime_type=data.mime_type,
        size_bytes=data.size_bytes,
        google_drive_file_id=data.google_drive_file_id,
        google_drive_folder_id=target_folder_id,
    )

    db.add(media_file)
    db.commit()
    db.refresh(media_file)

    return {
        "message": "Upload completed successfully.",
        "id": media_file.id,
        "google_drive_file_id": media_file.google_drive_file_id,
    }


# ---------------------------------------------------------
# List files
# ---------------------------------------------------------

@router.get("")
def list_my_files(
    all_files: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(MediaFile)
    if not (all_files and (current_user.is_admin or current_user.role == "manager")):
        query = query.where(MediaFile.owner_id == current_user.id)

    files = db.scalars(
        query.order_by(MediaFile.created_at.desc())
    ).all()

    return [
        {
            "id": file.id,
            "name": file.name,
            "mime_type": file.mime_type,
            "size_bytes": file.size_bytes,
            "google_drive_file_id": file.google_drive_file_id,
            "google_drive_folder_id": file.google_drive_folder_id,
            "created_at": file.created_at.isoformat(),
        }
        for file in files
    ]


# ---------------------------------------------------------
# Get single file metadata
# ---------------------------------------------------------

@router.get("/{media_id}")
def get_my_file(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(MediaFile).where(MediaFile.id == media_id)
    if not (current_user.is_admin or current_user.role == "manager"):
        query = query.where(MediaFile.owner_id == current_user.id)

    media_file = db.scalar(query)

    if media_file is None:
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    drive_file = get_drive_file(
        media_file.google_drive_file_id
    )

    return {
        "id": media_file.id,
        "name": media_file.name,
        "mime_type": media_file.mime_type,
        "size_bytes": media_file.size_bytes,
        "google_drive_file_id": media_file.google_drive_file_id,
        "google_drive_folder_id": media_file.google_drive_folder_id,
        "created_at": media_file.created_at.isoformat(),
        "google_drive": {
            "id": drive_file.get("id"),
            "name": drive_file.get("name"),
            "mime_type": drive_file.get("mimeType"),
            "size": drive_file.get("size"),
            "web_content_link": drive_file.get(
                "webContentLink"
            ),
        },
    }


# ---------------------------------------------------------
# Download or stream file (Controls: Download vs Preview)
# ---------------------------------------------------------

@router.get("/{media_id}/download")
def download_my_file(
    media_id: int,
    request: Request,
    inline: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    perms = get_user_permissions_dict(current_user, db)

    if inline:
        if not (perms.get("can_preview") or perms.get("can_download")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: Preview access is disabled for your account.",
            )
    else:
        if not perms.get("can_download"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: Download access is disabled for your account.",
            )

    query = select(MediaFile).where(MediaFile.id == media_id)
    if not (current_user.is_admin or current_user.role == "manager"):
        query = query.where(MediaFile.owner_id == current_user.id)

    media_file = db.scalar(query)

    if media_file is None:
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    range_header = request.headers.get("range")
    drive_response = get_drive_file_stream(
        file_id=media_file.google_drive_file_id,
        range_header=range_header,
    )

    def stream_generator():
        try:
            for chunk in drive_response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    yield chunk
        finally:
            drive_response.close()

    disposition_type = "inline" if inline else "attachment"
    encoded_filename = urllib.parse.quote(media_file.name)
    content_disposition = (
        f'{disposition_type}; filename="{encoded_filename}"; '
        f"filename*=UTF-8''{encoded_filename}"
    )

    response_headers = {
        "Content-Disposition": content_disposition,
        "Accept-Ranges": "bytes",
    }

    if "Content-Range" in drive_response.headers:
        response_headers["Content-Range"] = drive_response.headers["Content-Range"]

    if "Content-Length" in drive_response.headers:
        response_headers["Content-Length"] = drive_response.headers["Content-Length"]
    elif not range_header:
        response_headers["Content-Length"] = str(media_file.size_bytes)

    return StreamingResponse(
        stream_generator(),
        status_code=drive_response.status_code,
        media_type=media_file.mime_type,
        headers=response_headers,
    )


# ---------------------------------------------------------
# Rename file
# ---------------------------------------------------------

@router.patch("/{media_id}")
def rename_my_file(
    media_id: int,
    data: RenameMediaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_rename")),
):
    clean_new_name = sanitize_and_validate_file(data.name)

    query = select(MediaFile).where(MediaFile.id == media_id)
    if not (current_user.is_admin or current_user.role == "manager"):
        query = query.where(MediaFile.owner_id == current_user.id)

    media_file = db.scalar(query)

    if media_file is None:
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    rename_drive_file(
        file_id=media_file.google_drive_file_id,
        new_name=clean_new_name,
    )

    media_file.name = clean_new_name
    db.commit()
    db.refresh(media_file)

    return {
        "message": "File renamed successfully.",
        "id": media_file.id,
        "name": media_file.name,
        "mime_type": media_file.mime_type,
        "size_bytes": media_file.size_bytes,
        "google_drive_file_id": media_file.google_drive_file_id,
        "google_drive_folder_id": media_file.google_drive_folder_id,
        "created_at": media_file.created_at.isoformat(),
    }


# ---------------------------------------------------------
# Delete file
# ---------------------------------------------------------

@router.delete("/{media_id}")
def delete_my_file(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_delete")),
):
    query = select(MediaFile).where(MediaFile.id == media_id)
    if not (current_user.is_admin or current_user.role == "manager"):
        query = query.where(MediaFile.owner_id == current_user.id)

    media_file = db.scalar(query)

    if media_file is None:
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    delete_drive_file(media_file.google_drive_file_id)

    db.delete(media_file)
    db.commit()

    return {
        "message": "File deleted successfully.",
        "id": media_id,
    }