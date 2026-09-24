import secrets
import string

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


CHARACTERS = string.ascii_letters + string.digits


def generate_identifier(db: Session) -> str:
    while True:
        identifier = "".join(
            secrets.choice(CHARACTERS)
            for _ in range(8)
        )

        existing_user = db.scalar(
            select(User).where(
                User.identifier == identifier
            )
        )

        if existing_user is None:
            return identifier