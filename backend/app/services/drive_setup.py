from app.services.google_drive import get_drive_service


ROOT_FOLDER_NAME = "Cloud Storage Portal"


def create_root_folder():
    drive = get_drive_service()

    query = (
        f"name = '{ROOT_FOLDER_NAME}' "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )

    existing = (
        drive.files()
        .list(
            q=query,
            spaces="drive",
            fields="files(id,name)",
        )
        .execute()
    )

    if existing.get("files"):
        return existing["files"][0]

    folder = (
        drive.files()
        .create(
            body={
                "name": ROOT_FOLDER_NAME,
                "mimeType": "application/vnd.google-apps.folder",
            },
            fields="id,name",
        )
        .execute()
    )

    return folder


def create_user_folder(user_identifier: str):
    drive = get_drive_service()

    root_folder = create_root_folder()

    query = (
        f"name = '{user_identifier}' "
        "and mimeType = 'application/vnd.google-apps.folder' "
        f"and '{root_folder['id']}' in parents "
        "and trashed = false"
    )

    existing = (
        drive.files()
        .list(
            q=query,
            spaces="drive",
            fields="files(id,name)",
        )
        .execute()
    )

    if existing.get("files"):
        return existing["files"][0]

    folder = (
        drive.files()
        .create(
            body={
                "name": user_identifier,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [root_folder["id"]],
            },
            fields="id,name",
        )
        .execute()
    )

    return folder