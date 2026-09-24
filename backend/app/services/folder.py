from fastapi import HTTPException
from app.services.drive_setup import create_root_folder
from app.services.google_drive import get_drive_service


def create_custom_folder(name: str, parent_folder_id: str | None = None):
    drive = get_drive_service()

    if parent_folder_id is None:
        root_folder = create_root_folder()
        parent_id = root_folder["id"]
    else:
        parent_id = parent_folder_id

    try:
        folder = (
            drive.files()
            .create(
                body={
                    "name": name,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [parent_id],
                },
                fields="id,name,parents",
            )
            .execute()
        )
        return folder
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to create folder in Google Drive: {exc}",
        )
