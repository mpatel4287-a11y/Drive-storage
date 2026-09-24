from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterResponse(BaseModel):
    id: int
    email: EmailStr
    identifier: str
    is_admin: bool
    role: str
    status: str
    message: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    identifier: str
    is_admin: bool
    role: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=8, max_length=128)


class ResetPasswordResponse(BaseModel):
    message: str


class MemberResponse(BaseModel):
    id: int
    email: EmailStr
    identifier: str
    is_admin: bool
    role: str
    status: str
    is_active: bool
    created_at: str
    permissions: dict


class ApproveJoinRequest(BaseModel):
    access_preset: str = Field(
        default="both",
        description="both | download_only | upload_only | preview_only",
    )
    role: str = Field(
        default="member",
        description="member | manager",
    )


class UpdateRoleRequest(BaseModel):
    role: str = Field(
        description="manager | member",
    )


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_folder_id: str | None = None


class FolderResponse(BaseModel):
    id: int
    name: str
    google_drive_folder_id: str
    parent_folder_id: str | None
    creator_id: int
    created_at: str