"""Crypto utilities - Fernet key management."""

from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class KeyDecryptError(RuntimeError):
    """密钥无法解密：主密钥被替换/损坏，或密文不是本机加密的。"""


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
        """解密失败要显式报错：静默返回空串会变成"鉴权失败"，无法定位。"""
        try:
            return cls.get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError) as exc:
            raise KeyDecryptError(
                "密钥无法解密（主密钥可能已更换或损坏），请到「模型配置」重新填写 API Key"
            ) from exc
