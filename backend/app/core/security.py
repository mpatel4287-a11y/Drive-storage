from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import User, UserPermission


ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

bearer_scheme = HTTPBearer()


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "exp": expire,
    }

    return jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=ALGORITHM,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[ALGORITHM],
        )

        user_id = payload.get("sub")

        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token.",
            )

        user_id = int(user_id)

    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    user = db.scalar(
        select(User).where(User.id == user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )

    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your joining request is pending approval by an admin.",
        )

    if user.status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your joining request was rejected.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled.",
        )

    return user


def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    if not (current_user.is_admin or current_user.role == "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )

    return current_user


def get_current_manager_or_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    if not (current_user.is_admin or current_user.role in ("admin", "manager")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager or Admin access required.",
        )

    return current_user


# =========================================================
# PERMISSION HELPERS
# =========================================================

def get_or_create_user_permissions(
    user: User,
    db: Session,
) -> UserPermission:
    perm = db.scalar(
        select(UserPermission).where(
            UserPermission.user_id == user.id
        )
    )

    if perm is None:
        perm = UserPermission(
            user_id=user.id,
            can_upload=True,
            can_download=True,
            can_preview=True,
            can_delete=True,
            can_rename=True,
            can_create_folder=(user.role in ("admin", "manager")),
            can_share=True,
        )
        db.add(perm)
        db.commit()
        db.refresh(perm)

    return perm


def get_user_permissions_dict(
    user: User,
    db: Session,
) -> dict:
    if user.is_admin or user.role == "admin":
        return {
            "can_upload": True,
            "can_download": True,
            "can_preview": True,
            "can_delete": True,
            "can_rename": True,
            "can_create_folder": True,
            "can_share": True,
            "is_admin": True,
            "role": "admin",
        }

    if user.role == "manager":
        return {
            "can_upload": True,
            "can_download": True,
            "can_preview": True,
            "can_delete": True,
            "can_rename": True,
            "can_create_folder": True,
            "can_share": True,
            "is_admin": False,
            "role": "manager",
        }

    perm = get_or_create_user_permissions(user, db)
    return {
        "can_upload": perm.can_upload,
        "can_download": perm.can_download,
        "can_preview": perm.can_preview,
        "can_delete": perm.can_delete,
        "can_rename": perm.can_rename,
        "can_create_folder": perm.can_create_folder,
        "can_share": perm.can_share,
        "is_admin": False,
        "role": user.role,
    }


def apply_permission_preset(
    perm: UserPermission,
    preset: str,
):
    if preset == "download_only":
        perm.can_download = True
        perm.can_preview = True
        perm.can_upload = False
        perm.can_delete = False
        perm.can_rename = False
        perm.can_create_folder = False
    elif preset == "upload_only":
        perm.can_upload = True
        perm.can_download = False
        perm.can_preview = False
        perm.can_delete = False
        perm.can_rename = False
        perm.can_create_folder = False
    elif preset == "preview_only":
        perm.can_download = False
        perm.can_preview = True
        perm.can_upload = False
        perm.can_delete = False
        perm.can_rename = False
        perm.can_create_folder = False
    elif preset == "both":
        perm.can_download = True
        perm.can_upload = True
        perm.can_preview = True
        perm.can_delete = True
        perm.can_rename = True
        perm.can_create_folder = False


def require_permission(permission_name: str):
    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if current_user.is_admin or current_user.role == "admin":
            return current_user

        if current_user.role == "manager":
            return current_user

        perms = get_user_permissions_dict(current_user, db)
        if not perms.get(permission_name, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission_name}' is disabled for your account.",
            )

        return current_user

    return dependency