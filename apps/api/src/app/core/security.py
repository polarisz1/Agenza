"""Crypto utilities - Fernet key management."""
from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class KeyManager:
    """Fernet key: generated once, persisted locally."""

    _fernet: Fernet | None = None

    @classmethod
    def get_fernet(cls) -> Fernet:
        if cls._fernet is not None:
            return cls._fernet

        key_file = Path(settings.secret_file)
        key_file.parent.mkdir(parents=True, exist_ok=True)

        if key_file.exists():
            key = key_file.read_bytes().strip()
        else:
            key = Fernet.generate_key()
            key_file.write_bytes(key)
            key_file.chmod(0o600)

        cls._fernet = Fernet(key)
        return cls._fernet

    @classmethod
    def encrypt(cls, plaintext: str) -> str:
        return cls.get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")

    @classmethod
    def decrypt(cls, ciphertext: str) -> str:
        try:
            return cls.get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            return ""
