import sys
from app.db import SessionLocal
from app.models import User
from app.services.password import hash_password

def main():
    if len(sys.argv) < 3:
        print("Usage: PYTHONPATH=. .venv/bin/python reset_password.py <email> <new_password>")
        sys.exit(1)

    email = sys.argv[1]
    new_password = sys.argv[2]

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).first()
        if not user:
            print(f"Error: User with email '{email}' not found.")
            sys.exit(1)

        user.password_hash = hash_password(new_password)
        db.commit()
        print(f"Success: Password for {email} ({user.role}) has been updated successfully!")
    finally:
        db.close()

if __name__ == "__main__":
    main()
