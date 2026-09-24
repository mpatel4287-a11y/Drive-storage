from datetime import datetime, timedelta
import io
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
import qrcode
import qrcode.image.svg
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user, require_permission
from app.db import get_db
from app.models import MediaFile, QrUploadSession, User
from app.services.drive_setup import create_user_folder
from app.services.google_drive import (
    create_resumable_upload_session,
    get_drive_file,
)


router = APIRouter(
    prefix="/qr",
    tags=["QR Upload"],
)


# ---------------------------------------------------------
# Schemas
# ---------------------------------------------------------

class CreateQrSessionRequest(BaseModel):
    expires_in_minutes: int = Field(
        default=30,
        ge=1,
        le=1440,
    )


class QrSessionResponse(BaseModel):
    session_id: int
    token: str
    qr_url: str
    qr_svg: str
    expires_at: str


class QrStatusResponse(BaseModel):
    valid: bool
    target_user_identifier: str
    expires_at: str


class QrUploadSessionRequest(BaseModel):
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


class QrCompleteUploadRequest(BaseModel):
    google_drive_file_id: str
    filename: str
    mime_type: str
    size_bytes: int = Field(
        gt=0,
    )


# ---------------------------------------------------------
# Helpers
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


def validate_qr_token(token: str, db: Session) -> tuple[QrUploadSession, User]:
    qr_session = db.scalar(
        select(QrUploadSession).where(
            QrUploadSession.token == token,
            QrUploadSession.is_active.is_(True),
        )
    )

    if qr_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="QR upload session not found or inactive.",
        )

    if datetime.utcnow() > qr_session.expires_at:
        qr_session.is_active = False
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="QR upload session has expired.",
        )

    user = db.scalar(
        select(User).where(User.id == qr_session.user_id)
    )

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account associated with this session is inactive.",
        )

    return qr_session, user


# ---------------------------------------------------------
# Create QR session
# ---------------------------------------------------------

@router.post("/session", response_model=QrSessionResponse)
def create_qr_session(
    data: CreateQrSessionRequest = CreateQrSessionRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_upload")),
):
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(
        minutes=data.expires_in_minutes
    )

    session = QrUploadSession(
        user_id=current_user.id,
        token=token,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # QR URL for mobile browser
    qr_url = f"{settings.frontend_url}/qr-upload?token={token}"

    # Generate standalone SVG QR code
    factory = qrcode.image.svg.SvgImage
    qr_img = qrcode.make(qr_url, image_factory=factory)
    svg_buffer = io.BytesIO()
    qr_img.save(svg_buffer)
    svg_content = svg_buffer.getvalue().decode("utf-8")

    return {
        "session_id": session.id,
        "token": session.token,
        "qr_url": qr_url,
        "qr_svg": svg_content,
        "expires_at": session.expires_at.isoformat(),
    }


# ---------------------------------------------------------
# Render QR code image
# ---------------------------------------------------------

@router.get("/{token}/code")
def get_qr_image(
    token: str,
    db: Session = Depends(get_db),
):
    qr_session, _ = validate_qr_token(token, db)
    qr_url = f"{settings.frontend_url}/qr-upload?token={qr_session.token}"

    factory = qrcode.image.svg.SvgImage
    qr_img = qrcode.make(qr_url, image_factory=factory)
    svg_buffer = io.BytesIO()
    qr_img.save(svg_buffer)

    return Response(
        content=svg_buffer.getvalue(),
        media_type="image/svg+xml",
    )


# ---------------------------------------------------------
# Verify QR session status
# ---------------------------------------------------------

@router.get("/{token}/status", response_model=QrStatusResponse)
def get_qr_session_status(
    token: str,
    db: Session = Depends(get_db),
):
    qr_session, target_user = validate_qr_token(token, db)

    return {
        "valid": True,
        "target_user_identifier": target_user.identifier,
        "expires_at": qr_session.expires_at.isoformat(),
    }


# ---------------------------------------------------------
# Phone: Request resumable upload session via QR
# ---------------------------------------------------------

@router.post("/{token}/upload/session")
def create_upload_session_via_qr(
    token: str,
    data: QrUploadSessionRequest,
    db: Session = Depends(get_db),
):
    clean_filename = sanitize_and_validate_file(data.filename, data.size_bytes)
    _, target_user = validate_qr_token(token, db)

    # Get target user's Drive folder
    user_folder = create_user_folder(target_user.identifier)

    upload_url = create_resumable_upload_session(
        filename=clean_filename,
        mime_type=data.mime_type,
        size_bytes=data.size_bytes,
        parent_folder_id=user_folder["id"],
    )

    return {
        "upload_url": upload_url,
        "filename": clean_filename,
        "mime_type": data.mime_type,
        "size_bytes": data.size_bytes,
        "recommended_chunk_size": 8 * 1024 * 1024,
    }


# ---------------------------------------------------------
# Phone: Complete upload via QR
# ---------------------------------------------------------

@router.post("/{token}/upload/complete")
def complete_upload_via_qr(
    token: str,
    data: QrCompleteUploadRequest,
    db: Session = Depends(get_db),
):
    clean_filename = sanitize_and_validate_file(data.filename, data.size_bytes)
    qr_session, target_user = validate_qr_token(token, db)

    drive_file = get_drive_file(data.google_drive_file_id)

    if drive_file.get("trashed"):
        raise HTTPException(
            status_code=400,
            detail="The uploaded Google Drive file is in trash.",
        )

    drive_size = int(drive_file.get("size", 0))
    if drive_size != data.size_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file size does not match the requested size.",
        )

    user_folder = create_user_folder(target_user.identifier)
    parents = drive_file.get("parents", [])
    if user_folder["id"] not in parents:
        raise HTTPException(
            status_code=403,
            detail="This file does not belong to the user's storage folder.",
        )

    # Prevent duplicate
    existing = db.scalar(
        select(MediaFile).where(
            MediaFile.google_drive_file_id == data.google_drive_file_id
        )
    )
    if existing:
        return {
            "message": "File metadata already exists.",
            "id": existing.id,
            "google_drive_file_id": existing.google_drive_file_id,
        }

    media_file = MediaFile(
        owner_id=target_user.id,
        name=clean_filename,
        mime_type=data.mime_type,
        size_bytes=data.size_bytes,
        google_drive_file_id=data.google_drive_file_id,
        google_drive_folder_id=user_folder["id"],
    )
    db.add(media_file)
    db.commit()
    db.refresh(media_file)

    return {
        "message": "Upload completed successfully via QR session.",
        "id": media_file.id,
        "google_drive_file_id": media_file.google_drive_file_id,
    }
