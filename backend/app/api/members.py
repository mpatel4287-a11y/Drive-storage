from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    apply_permission_preset,
    get_current_admin,
    get_current_manager_or_admin,
    get_or_create_user_permissions,
    get_user_permissions_dict,
)
from app.db import get_db
from app.models import User, UserPermission
from app.schemas import (
    ApproveJoinRequest,
    MemberResponse,
    UpdateRoleRequest,
)
from app.services.drive_setup import create_user_folder


router = APIRouter(
    prefix="/members",
    tags=["Member Management"],
)


class MemberPermissionsUpdateRequest(BaseModel):
    access_preset: str | None = None
    can_upload: bool | None = None
    can_download: bool | None = None
    can_preview: bool | None = None
    can_delete: bool | None = None
    can_rename: bool | None = None
    can_create_folder: bool | None = None
    can_share: bool | None = None


class MemberStatusUpdateRequest(BaseModel):
    is_active: bool


# ---------------------------------------------------------
# List pending join requests
# ---------------------------------------------------------

@router.get("/join-requests")
def list_join_requests(
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
):
    pending_users = db.scalars(
        select(User)
        .where(User.status == "pending")
        .order_by(User.created_at.asc())
    ).all()

    return [
        {
            "id": u.id,
            "email": u.email,
            "identifier": u.identifier,
            "created_at": u.created_at.isoformat(),
        }
        for u in pending_users
    ]


# ---------------------------------------------------------
# Approve join request
# ---------------------------------------------------------

@router.post("/join-requests/{user_id}/approve")
def approve_join_request(
    user_id: int,
    data: ApproveJoinRequest = ApproveJoinRequest(),
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
):
    target_user = db.scalar(
        select(User).where(User.id == user_id)
    )

    if target_user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    if target_user.status == "approved":
        raise HTTPException(
            status_code=400,
            detail="User is already approved.",
        )

    # Only admin can approve directly as manager
    assigned_role = data.role
    if assigned_role == "manager" and not current_actor.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Only admin can promote a user to manager.",
        )

    target_user.status = "approved"
    target_user.is_active = True
    target_user.role = assigned_role

    # Initialize permissions
    perm = get_or_create_user_permissions(target_user, db)
    apply_permission_preset(perm, data.access_preset)

    if assigned_role == "manager":
        perm.can_create_folder = True

    db.commit()
    db.refresh(target_user)

    # Initialize user Google Drive storage folder
    folder = create_user_folder(target_user.identifier)

    return {
        "message": f"User {target_user.email} approved successfully.",
        "user_id": target_user.id,
        "email": target_user.email,
        "role": target_user.role,
        "status": target_user.status,
        "drive_folder": folder,
    }


# ---------------------------------------------------------
# Reject join request
# ---------------------------------------------------------

@router.post("/join-requests/{user_id}/reject")
def reject_join_request(
    user_id: int,
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
):
    target_user = db.scalar(
        select(User).where(User.id == user_id)
    )

    if target_user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    target_user.status = "rejected"
    target_user.is_active = False
    db.commit()

    return {
        "message": f"Join request for {target_user.email} was rejected.",
        "user_id": target_user.id,
    }


# ---------------------------------------------------------
# List all members
# ---------------------------------------------------------

@router.get("", response_model=list[MemberResponse])
def list_members(
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
):
    users = db.scalars(
        select(User).order_by(User.id.asc())
    ).all()

    result = []
    for u in users:
        perms = get_user_permissions_dict(u, db)
        result.append(
            {
                "id": u.id,
                "email": u.email,
                "identifier": u.identifier,
                "is_admin": u.is_admin,
                "role": u.role,
                "status": u.status,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat(),
                "permissions": perms,
            }
        )

    return result


# ---------------------------------------------------------
# Promote or demote role (Admin only)
# ---------------------------------------------------------

@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    data: UpdateRoleRequest,
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
            detail="Cannot change role of permanent admin.",
        )

    if data.role not in ("manager", "member"):
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be 'manager' or 'member'.",
        )

    target_user.role = data.role
    perm = get_or_create_user_permissions(target_user, db)
    if data.role == "manager":
        perm.can_create_folder = True

    db.commit()
    db.refresh(target_user)

    return {
        "message": f"User role updated to '{target_user.role}'.",
        "user_id": target_user.id,
        "email": target_user.email,
        "role": target_user.role,
    }


# ---------------------------------------------------------
# Update member permissions (Admin & Manager)
# ---------------------------------------------------------

@router.put("/users/{user_id}/permissions")
def update_member_permissions(
    user_id: int,
    data: MemberPermissionsUpdateRequest,
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
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
            detail="Cannot modify permissions of permanent admin.",
        )

    # Managers cannot modify other managers or admins
    if not current_actor.is_admin and target_user.role in ("admin", "manager"):
        raise HTTPException(
            status_code=403,
            detail="Managers cannot modify permissions of other managers or admins.",
        )

    perm = get_or_create_user_permissions(target_user, db)

    # Apply preset if specified
    if data.access_preset:
        apply_permission_preset(perm, data.access_preset)

    # Apply specific overrides
    if data.can_upload is not None:
        perm.can_upload = data.can_upload
    if data.can_download is not None:
        perm.can_download = data.can_download
    if data.can_preview is not None:
        perm.can_preview = data.can_preview
    if data.can_delete is not None:
        perm.can_delete = data.can_delete
    if data.can_rename is not None:
        perm.can_rename = data.can_rename
    if data.can_create_folder is not None:
        perm.can_create_folder = data.can_create_folder
    if data.can_share is not None:
        perm.can_share = data.can_share

    db.commit()
    db.refresh(perm)

    return {
        "message": f"Permissions updated for {target_user.email}.",
        "user_id": target_user.id,
        "permissions": get_user_permissions_dict(target_user, db),
    }


# ---------------------------------------------------------
# Update member active status (Admin & Manager)
# ---------------------------------------------------------

@router.patch("/users/{user_id}/status")
def update_member_status(
    user_id: int,
    data: MemberStatusUpdateRequest,
    db: Session = Depends(get_db),
    current_actor: User = Depends(get_current_manager_or_admin),
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
            detail="Cannot disable permanent admin.",
        )

    if not current_actor.is_admin and target_user.role in ("admin", "manager"):
        raise HTTPException(
            status_code=403,
            detail="Managers cannot disable other managers or admins.",
        )

    target_user.is_active = data.is_active
    db.commit()

    action = "enabled" if data.is_active else "disabled"
    return {
        "message": f"Account for {target_user.email} has been {action}.",
        "user_id": target_user.id,
        "is_active": target_user.is_active,
    }
