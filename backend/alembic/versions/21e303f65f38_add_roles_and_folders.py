"""add_roles_and_folders

Revision ID: 21e303f65f38
Revises: 0d7843eeb56a
Create Date: 2026-09-25 00:24:45.464394

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '21e303f65f38'
down_revision: Union[str, Sequence[str], None] = '0d7843eeb56a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('folders',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('google_drive_folder_id', sa.String(length=255), nullable=False),
    sa.Column('parent_folder_id', sa.String(length=255), nullable=True),
    sa.Column('creator_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_folders_creator_id'), 'folders', ['creator_id'], unique=False)
    op.create_index(op.f('ix_folders_google_drive_folder_id'), 'folders', ['google_drive_folder_id'], unique=True)
    op.create_index(op.f('ix_folders_parent_folder_id'), 'folders', ['parent_folder_id'], unique=False)

    op.add_column('user_permissions', sa.Column('can_preview', sa.Boolean(), server_default=sa.text('true'), nullable=False))
    op.add_column('user_permissions', sa.Column('can_create_folder', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('users', sa.Column('role', sa.String(length=20), server_default='member', nullable=False))
    op.add_column('users', sa.Column('status', sa.String(length=20), server_default='approved', nullable=False))

    # Existing admin accounts get role='admin'
    op.execute("UPDATE users SET role = 'admin' WHERE is_admin = true")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'status')
    op.drop_column('users', 'role')
    op.drop_column('user_permissions', 'can_create_folder')
    op.drop_column('user_permissions', 'can_preview')
    op.drop_index(op.f('ix_folders_parent_folder_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_google_drive_folder_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_creator_id'), table_name='folders')
    op.drop_table('folders')
