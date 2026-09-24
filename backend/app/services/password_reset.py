import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PasswordResetToken


RESET_TOKEN_EXPIRE_MINUTES = 30


def generate_reset_token(db: Session, user_id: int) -> str:
    """
    Generate a secure password reset token.

    Only the SHA-256 hash of the token is stored in the database.
    The raw token is returned to the caller.
    """

    # Generate 32 cryptographically secure random bytes
    raw_token = secrets.token_urlsafe(32)

    # Hash the token before storing it
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    # Token expires after 30 minutes
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        minutes=RESET_TOKEN_EXPIRE_MINUTES
    )

    reset_token = PasswordResetToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    db.add(reset_token)
    db.commit()

    return raw_token


def get_valid_reset_token(
    db: Session,
    raw_token: str,
) -> PasswordResetToken | None:
    """
    Find a valid, unused, non-expired reset token.
    """

    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    reset_token = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash
        )
    )

    if reset_token is None:
        return None

    # Token can only be used once
    if reset_token.used_at is not None:
        return None

    # Token must not be expired
    if datetime.utcnow() >= reset_token.expires_at:
        return None

    return reset_token


def mark_reset_token_used(
    db: Session,
    reset_token: PasswordResetToken,
) -> None:
    """
    Mark a password reset token as used.
    """

    reset_token.used_at = datetime.utcnow()

    db.add(reset_token)
    db.commit()