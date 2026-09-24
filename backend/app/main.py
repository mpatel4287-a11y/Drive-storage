from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.auth import router as auth_router
from app.api.folders import router as folders_router
from app.api.media import router as media_router
from app.api.members import router as members_router
from app.api.permissions import router as permissions_router
from app.api.qr import router as qr_router
from app.core.config import settings
from app.core.limiter import limiter
from app.core.security import get_current_user
from app.models import User
from app.services.drive_setup import (
    create_root_folder,
    create_user_folder,
)
from app.services.google_drive import (
    exchange_google_code,
    get_google_authorization_url,
    get_drive_service,
)


app = FastAPI(
    title="Cloud Storage Portal API",
    version="1.0.0",
)

# ---------------------------------------------------------
# Rate Limiting Configuration
# ---------------------------------------------------------

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# ---------------------------------------------------------
# CORS Configuration
# ---------------------------------------------------------

cors_allowed_origins = settings.cors_origins
# If configured for wildcard, allow credentials requires explicit origins in standard browsers,
# but for local dev and flexibility we support settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allowed_origins if cors_allowed_origins != ["*"] else ["*"],
    allow_origin_regex=r"https?://.*\.trycloudflare\.com",
    allow_credentials=True if cors_allowed_origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "Content-Range",
        "Accept-Ranges",
        "Content-Length",
        "Content-Type",
    ],
)


# ---------------------------------------------------------
# Basic routes
# ---------------------------------------------------------

@app.get("/")
def root():
    return {
        "message": "Cloud Storage Portal API is running",
        "status": "ok",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
    }


# ---------------------------------------------------------
# Routers
# ---------------------------------------------------------

app.include_router(auth_router)
app.include_router(media_router)
app.include_router(permissions_router)
app.include_router(members_router)
app.include_router(folders_router)
app.include_router(qr_router)


# ---------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------

@app.get("/auth/google")
def google_login():
    authorization_url, state = get_google_authorization_url()

    return RedirectResponse(
        url=authorization_url,
        status_code=302,
    )


@app.get("/auth/google/callback")
def google_callback(
    code: str,
    state: str,
):
    credentials = exchange_google_code(
        code,
        state,
    )

    drive = get_drive_service()

    about = (
        drive.about()
        .get(
            fields="user(displayName,emailAddress)"
        )
        .execute()
    )

    return {
        "message": "Google Drive connected successfully",
        "google_account": about["user"],
        "token_saved": True,
    }


# ---------------------------------------------------------
# Google Drive setup
# ---------------------------------------------------------

@app.post("/drive/setup")
def setup_drive():
    folder = create_root_folder()

    return {
        "message": "Cloud Storage Portal folder is ready",
        "folder": folder,
    }


# ---------------------------------------------------------
# User Google Drive folder
# ---------------------------------------------------------

@app.post("/drive/setup-user")
def setup_user_folder(
    current_user: User = Depends(get_current_user),
):
    folder = create_user_folder(
        current_user.identifier
    )

    return {
        "message": "User Drive folder is ready",
        "folder": folder,
    }