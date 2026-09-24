from datetime import datetime, timedelta, timezone
import logging
import os
import shutil
import time

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import PasswordResetToken, QrUploadSession
from app.services.multi_stream import STAGING_BASE_DIR

logger = logging.getLogger(__name__)


def cleanup_orphaned_staging(max_age_hours: int = 24) -> int:
    """Removes abandoned upload session directories older than max_age_hours."""
    if not os.path.exists(STAGING_BASE_DIR):
        return 0

    cutoff = time.time() - (max_age_hours * 3600)
    cleaned_count = 0

    for entry in os.listdir(STAGING_BASE_DIR):
        entry_path = os.path.join(STAGING_BASE_DIR, entry)
        if os.path.isdir(entry_path):
            try:
                mtime = os.path.getmtime(entry_path)
                if mtime < cutoff:
                    shutil.rmtree(entry_path)
                    cleaned_count += 1
                    logger.info("Cleaned orphaned staging session: %s", entry_path)
            except Exception as e:
                logger.error("Error cleaning staging dir %s: %s", entry_path, e)

    return cleaned_count


def cleanup_expired_database_tokens(db: Session) -> dict:
    """Deletes expired password reset tokens and expired QR sessions."""
    now = datetime.utcnow()

    # Expired or used password reset tokens
    deleted_reset_tokens = db.query(PasswordResetToken).filter(
        (PasswordResetToken.expires_at < now) | (PasswordResetToken.used_at.is_not(None))
    ).delete(synchronize_session=False)

    # Expired QR sessions older than 48 hours
    qr_cutoff = now - timedelta(hours=48)
    deleted_qr_sessions = db.query(QrUploadSession).filter(
        (QrUploadSession.expires_at < qr_cutoff) | (QrUploadSession.is_active.is_(False))
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "deleted_password_reset_tokens": deleted_reset_tokens,
        "deleted_qr_sessions": deleted_qr_sessions,
    }


def run_maintenance() -> dict:
    """Runs all maintenance jobs."""
    cleaned_staging = cleanup_orphaned_staging(max_age_hours=24)
    db = SessionLocal()
    try:
        db_results = cleanup_expired_database_tokens(db)
    finally:
        db.close()

    return {
        "status": "success",
        "cleaned_staging_directories": cleaned_staging,
        **db_results,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    results = run_maintenance()
    print("Maintenance run complete:", results)
