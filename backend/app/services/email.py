import smtplib
from email.message import EmailMessage

from app.core.config import settings


def send_password_reset_email(
    recipient_email: str,
    reset_token: str,
) -> None:
    reset_link = (
        f"{settings.frontend_url}/reset-password"
        f"?token={reset_token}"
    )

    message = EmailMessage()
    message["Subject"] = "Cloud Storage Portal - Reset Password"
    message["From"] = settings.smtp_from_email
    message["To"] = recipient_email

    message.set_content(
        f"""Hello,

We received a request to reset your Cloud Storage Portal password.

Use the following link to reset your password:

{reset_link}

This password-reset link is valid for 30 minutes and can only be used once.

If you did not request a password reset, you can safely ignore this email.

Cloud Storage Portal
"""
    )

    with smtplib.SMTP(
        settings.smtp_host,
        settings.smtp_port,
        timeout=30,
    ) as server:
        server.starttls()
        server.login(
            settings.smtp_username,
            settings.smtp_password,
        )
        server.send_message(message)