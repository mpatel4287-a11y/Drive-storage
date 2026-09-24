from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    get_current_admin,
    get_current_user,
)
from app.db import get_db
from app.models import User
from app.schemas import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from app.services.email import send_password_reset_email
from app.services.identifier import generate_identifier
from app.services.password import hash_password, verify_password
from app.services.password_reset import (
    generate_reset_token,
    get_valid_reset_token,
    mark_reset_token_used,
)


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=201,
)
@limiter.limit("5/minute")
def register(
    request: Request,
    data: RegisterRequest,
    db: Session = Depends(get_db),
):
    existing_user = db.scalar(
        select(User).where(User.email == data.email)
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email is already registered.",
        )

    identifier = generate_identifier(db)

    # First user in the database becomes permanent admin; subsequent are pending join requests
    user_count = db.scalar(select(func.count(User.id)))
    is_first_user = user_count == 0

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        identifier=identifier,
        is_admin=is_first_user,
        role="admin" if is_first_user else "member",
        status="approved" if is_first_user else "pending",
        is_active=is_first_user,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    msg = (
        "Account created and approved (Admin)."
        if is_first_user
        else "Joining request submitted. Awaiting approval by an administrator."
    )

    return {
        "id": user.id,
        "email": user.email,
        "identifier": user.identifier,
        "is_admin": user.is_admin,
        "role": user.role,
        "status": user.status,
        "message": msg,
    }


@router.post(
    "/login",
    response_model=LoginResponse,
)
@limiter.limit("10/minute")
def login(
    request: Request,
    data: LoginRequest,
    db: Session = Depends(get_db),
):
    user = db.scalar(
        select(User).where(User.email == data.email)
    )

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    if not verify_password(
        data.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    if user.status == "pending":
        raise HTTPException(
            status_code=403,
            detail="Your joining request is pending approval by an admin.",
        )

    if user.status == "rejected":
        raise HTTPException(
            status_code=403,
            detail="Your joining request was rejected.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Account is disabled.",
        )

    access_token = create_access_token(user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "identifier": user.identifier,
        "is_admin": user.is_admin,
        "role": user.role,
    }


@router.get("/me")
def get_me(
    current_user: User = Depends(get_current_user),
):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "identifier": current_user.identifier,
        "is_admin": current_user.is_admin,
        "role": current_user.role,
        "status": current_user.status,
        "is_active": current_user.is_active,
    }


@router.get("/admin-test")
def admin_test(
    current_admin: User = Depends(get_current_admin),
):
    return {
        "message": "Admin access confirmed.",
        "admin_id": current_admin.id,
        "email": current_admin.email,
    }


@router.post(
    "/forgot-password",
    response_model=ForgotPasswordResponse,
)
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
    data: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    user = db.scalar(
        select(User).where(User.email == data.email)
    )

    # Do not reveal whether the email exists.
    if user is None or not user.is_active or user.status != "approved":
        return {
            "message": "If the email is registered, a password reset link will be sent."
        }

    reset_token = generate_reset_token(
        db=db,
        user_id=user.id,
    )

    send_password_reset_email(
        recipient_email=user.email,
        reset_token=reset_token,
    )

    return {
        "message": "If the email is registered, a password reset link will be sent."
    }


@router.post(
    "/reset-password",
    response_model=ResetPasswordResponse,
)
@limiter.limit("5/minute")
def reset_password(
    request: Request,
    data: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    reset_token = get_valid_reset_token(
        db=db,
        raw_token=data.token,
    )

    if reset_token is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired password reset token.",
        )

    user = db.scalar(
        select(User).where(User.id == reset_token.user_id)
    )

    if user is None or not user.is_active or user.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Invalid password reset request.",
        )

    user.password_hash = hash_password(data.new_password)

    db.add(user)
    db.commit()

    mark_reset_token_used(
        db=db,
        reset_token=reset_token,
    )

    return {
        "message": "Password has been reset successfully."
    }