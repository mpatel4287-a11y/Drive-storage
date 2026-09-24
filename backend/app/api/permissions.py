from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    get_current_admin,
    get_current_user,
    get_or_create_user_permissions,
    get_user_permissions_dict,
)
from app.db import get_db
from app.models import User, UserPermission


router = APIRouter(
    prefix="/permissions",
    tags=["Permissions"],
)


class UserPermissionsResponse(BaseModel):
    user_id: int
    email: str
    is_admin: bool
    can_upload: bool
    can_download: bool
    can_delete: bool
    can_rename: bool
    can_share: bool


class UpdatePermissionsRequest(BaseModel):
    can_upload: bool | None = None
    can_download: bool | None = None
    can_delete: bool | None = None
    can_rename: bool | None = None
    can_share: bool | None = None


@router.get(
    "/me",
    response_model=UserPermissionsResponse,
)
def get_my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    perms = get_user_permissions_dict(current_user, db)
    return {
        "user_id": current_user.id,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
        "can_upload": perms["can_upload"],
        "can_download": perms["can_download"],
        "can_delete": perms["can_delete"],
        "can_rename": perms["can_rename"],
        "can_share": perms["can_share"],
    }


@router.get(
    "/users/{user_id}",
    response_model=UserPermissionsResponse,
)
def get_user_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    target_user = db.scalar(
        select(User).where(User.id == user_id)
    )
    if target_user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    perms = get_user_permissions_dict(target_user, db)
    return {
        "user_id": target_user.id,
        "email": target_user.email,
        "is_admin": target_user.is_admin,
        "can_upload": perms["can_upload"],
        "can_download": perms["can_download"],
        "can_delete": perms["can_delete"],
        "can_rename": perms["can_rename"],
        "can_share": perms["can_share"],
    }


@router.put(
    "/users/{user_id}",
    response_model=UserPermissionsResponse,
)
def update_user_permissions(
    user_id: int,
    data: UpdatePermissionsRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    target_user = db.scalar(
        select(User).where(User.id == user_id)
    )
    if target_user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    if target_user.is_admin:
        raise HTTPException(
            status_code=400,
            detail="Cannot restrict permissions for an admin user.",
        )

    perm = get_or_create_user_permissions(target_user, db)

    if data.can_upload is not None:
        perm.can_upload = data.can_upload
    if data.can_download is not None:
        perm.can_download = data.can_download
    if data.can_delete is not None:
        perm.can_delete = data.can_delete
    if data.can_rename is not None:
        perm.can_rename = data.can_rename
    if data.can_share is not None:
        perm.can_share = data.can_share

    db.commit()
    db.refresh(perm)

    return {
        "user_id": target_user.id,
        "email": target_user.email,
        "is_admin": target_user.is_admin,
        "can_upload": perm.can_upload,
        "can_download": perm.can_download,
        "can_delete": perm.can_delete,
        "can_rename": perm.can_rename,
        "can_share": perm.can_share,
    }
