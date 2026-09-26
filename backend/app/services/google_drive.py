import json
import os
from pathlib import Path

from fastapi import HTTPException
from google.auth.transport.requests import Request, AuthorizedSession
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build


BASE_DIR = Path(__file__).resolve().parents[2]

CLIENT_SECRET_FILE = BASE_DIR / "google_client_secret.json"
TOKEN_FILE = BASE_DIR / "token.json"
OAUTH_SESSION_FILE = BASE_DIR / "oauth_session.json"

REDIRECT_URI = "http://localhost:8000/auth/google/callback"

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
]

DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"


# =========================================================
# GOOGLE OAUTH
# =========================================================

def create_google_flow() -> Flow:
    google_secret_env = os.getenv("GOOGLE_CLIENT_SECRET_JSON")
    if google_secret_env:
        try:
            client_config = json.loads(google_secret_env)
        except Exception as e:
            raise ValueError(f"Invalid GOOGLE_CLIENT_SECRET_JSON environment variable: {e}")
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            autogenerate_code_verifier=True,
        )
    elif CLIENT_SECRET_FILE.exists():
        flow = Flow.from_client_secrets_file(
            str(CLIENT_SECRET_FILE),
            scopes=SCOPES,
            autogenerate_code_verifier=True,
        )
    else:
        raise FileNotFoundError(
            f"Google OAuth client secret not found at {CLIENT_SECRET_FILE} or in GOOGLE_CLIENT_SECRET_JSON env."
        )

    flow.redirect_uri = REDIRECT_URI

    return flow


def get_google_authorization_url():
    flow = create_google_flow()

    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )

    OAUTH_SESSION_FILE.write_text(
        json.dumps(
            {
                "state": state,
                "code_verifier": flow.code_verifier,
            }
        ),
        encoding="utf-8",
    )

    return authorization_url, state


def exchange_google_code(
    code: str,
    state: str,
) -> Credentials:

    if not OAUTH_SESSION_FILE.exists():
        raise HTTPException(
            status_code=400,
            detail="OAuth session not found. Start Google login again.",
        )

    session = json.loads(
        OAUTH_SESSION_FILE.read_text(
            encoding="utf-8"
        )
    )

    if state != session["state"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid OAuth state.",
        )

    flow = create_google_flow()

    flow.code_verifier = session["code_verifier"]

    flow.fetch_token(
        code=code
    )

    credentials = flow.credentials

    TOKEN_FILE.write_text(
        credentials.to_json(),
        encoding="utf-8",
    )

    OAUTH_SESSION_FILE.unlink(
        missing_ok=True
    )

    return credentials


def get_google_credentials() -> Credentials:
    token_json_env = os.getenv("GOOGLE_TOKEN_JSON")
    if token_json_env:
        try:
            info = json.loads(token_json_env)
            credentials = Credentials.from_authorized_user_info(info, SCOPES)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Invalid GOOGLE_TOKEN_JSON environment variable: {e}",
            )
    elif TOKEN_FILE.exists():
        credentials = Credentials.from_authorized_user_file(
            str(TOKEN_FILE),
            SCOPES,
        )
    else:
        raise HTTPException(
            status_code=401,
            detail="Google Drive is not connected yet.",
        )

    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        if TOKEN_FILE.parent.exists():
            try:
                TOKEN_FILE.write_text(
                    credentials.to_json(),
                    encoding="utf-8",
                )
            except Exception:
                pass

    if not credentials.valid:
        raise HTTPException(
            status_code=401,
            detail="Google Drive authorization is invalid.",
        )

    return credentials


def get_drive_service():
    credentials = get_google_credentials()

    return build(
        "drive",
        "v3",
        credentials=credentials,
    )


# =========================================================
# RESUMABLE UPLOAD
# =========================================================

def create_resumable_upload_session(
    filename: str,
    mime_type: str,
    size_bytes: int,
    parent_folder_id: str,
) -> str:

    credentials = get_google_credentials()

    session = AuthorizedSession(credentials)

    metadata = {
        "name": filename,
        "mimeType": mime_type,
        "parents": [
            parent_folder_id,
        ],
    }

    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
        "X-Upload-Content-Length": str(size_bytes),
    }

    response = session.post(
        f"{DRIVE_UPLOAD_BASE}/files?uploadType=resumable",
        headers=headers,
        json=metadata,
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail=(
                "Google Drive failed to create "
                f"the upload session: {response.text}"
            ),
        )

    upload_url = response.headers.get("Location")

    if not upload_url:
        raise HTTPException(
            status_code=502,
            detail="Google Drive did not return an upload session URL.",
        )

    return upload_url


def get_resumable_upload_status(
    upload_url: str,
    size_bytes: int,
) -> dict:

    credentials = get_google_credentials()
    session = AuthorizedSession(credentials)

    headers = {
        "Content-Length": "0",
        "Content-Range": f"bytes */{size_bytes}",
    }

    response = session.put(
        upload_url,
        headers=headers,
        timeout=30,
    )

    if response.status_code == 308:
        range_header = response.headers.get("Range")
        bytes_received = 0
        if range_header and range_header.startswith("bytes=0-"):
            bytes_received = int(range_header.split("-")[1]) + 1

        return {
            "status": "in_progress",
            "bytes_received": bytes_received,
            "next_byte": bytes_received,
            "drive_file_id": None,
        }

    if response.status_code in (200, 201):
        data = response.json()
        return {
            "status": "completed",
            "bytes_received": size_bytes,
            "next_byte": size_bytes,
            "drive_file_id": data.get("id"),
        }

    raise HTTPException(
        status_code=502,
        detail=f"Unable to query upload status from Google Drive: {response.text}",
    )


# =========================================================
# GET DRIVE FILE
# =========================================================

def get_drive_file(
    file_id: str,
):
    drive = get_drive_service()

    try:
        return (
            drive.files()
            .get(
                fileId=file_id,
                fields=(
                    "id,"
                    "name,"
                    "mimeType,"
                    "size,"
                    "parents,"
                    "createdTime,"
                    "modifiedTime,"
                    "webContentLink,"
                    "trashed"
                ),
            )
            .execute()
        )

    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Google Drive file not found: {exc}",
        )


# =========================================================
# STREAM DRIVE FILE (DOWNLOAD / PREVIEW)
# =========================================================

def get_drive_file_stream(
    file_id: str,
    range_header: str | None = None,
):
    credentials = get_google_credentials()
    session = AuthorizedSession(credentials)

    headers = {}
    if range_header:
        headers["Range"] = range_header

    url = f"{DRIVE_API_BASE}/files/{file_id}?alt=media"

    response = session.get(
        url,
        headers=headers,
        stream=True,
        timeout=60,
    )

    if response.status_code not in (200, 206):
        raise HTTPException(
            status_code=response.status_code if response.status_code in (400, 401, 403, 404) else 502,
            detail=f"Unable to retrieve file from Google Drive: {response.text}",
        )

    return response


# =========================================================
# RENAME DRIVE FILE
# =========================================================

def rename_drive_file(
    file_id: str,
    new_name: str,
):
    drive = get_drive_service()

    try:
        return (
            drive.files()
            .update(
                fileId=file_id,
                body={"name": new_name},
                fields="id,name",
            )
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to rename Google Drive file: {exc}",
        )


# =========================================================
# DELETE DRIVE FILE
# =========================================================

def delete_drive_file(
    file_id: str,
):
    drive = get_drive_service()

    try:
        drive.files().delete(
            fileId=file_id
        ).execute()

    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Unable to delete Google Drive file: {exc}",
        )


# =========================================================
# LIST DRIVE FILES
# =========================================================

def list_drive_files(
    folder_id: str,
):
    drive = get_drive_service()

    query = (
        f"'{folder_id}' in parents "
        "and trashed = false"
    )

    return (
        drive.files()
        .list(
            q=query,
            spaces="drive",
            fields=(
                "files("
                "id,"
                "name,"
                "mimeType,"
                "size,"
                "parents,"
                "createdTime,"
                "modifiedTime,"
                "webContentLink"
                ")"
            ),
            orderBy="createdTime desc",
        )
        .execute()
    )