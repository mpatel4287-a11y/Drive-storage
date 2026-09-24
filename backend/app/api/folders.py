import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_permission
from app.db import get_db
from app.models import Folder, User
from app.schemas import FolderCreateRequest, FolderResponse
from app.services.folder import create_custom_folder


router = APIRouter(
    prefix="/folders",
    tags=["Folders"],
)


@router.post(
    "",
    response_model=FolderResponse,
    status_code=201,
)
def create_folder(
    data: FolderCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_create_folder")),
):
    clean_name = os.path.basename(data.name).strip()
    if not clean_name or clean_name in (".", ".."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid folder name.",
        )

    # Create the folder in Google Drive
    drive_folder = create_custom_folder(
        name=clean_name,
        parent_folder_id=data.parent_folder_id,
    )

    # Record in database
    folder = Folder(
        name=clean_name,
        google_drive_folder_id=drive_folder["id"],
        parent_folder_id=data.parent_folder_id,
        creator_id=current_user.id,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)

    return {
        "id": folder.id,
        "name": folder.name,
        "google_drive_folder_id": folder.google_drive_folder_id,
        "parent_folder_id": folder.parent_folder_id,
        "creator_id": folder.creator_id,
        "created_at": folder.created_at.isoformat(),
    }


@router.get(
    "",
    response_model=list[FolderResponse],
)
def list_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folders = db.scalars(
        select(Folder).order_by(Folder.created_at.desc())
    ).all()

    return [
        {
            "id": f.id,
            "name": f.name,
            "google_drive_folder_id": f.google_drive_folder_id,
            "parent_folder_id": f.parent_folder_id,
            "creator_id": f.creator_id,
            "created_at": f.created_at.isoformat(),
        }
        for f in folders
    ]
