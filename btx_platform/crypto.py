"""Application-level encryption for integration credentials at rest.

Connection.signing_secret and any stored HubSpot token are encrypted with
Fernet (AES-128-CBC + HMAC) using a key derived from BTX_ENCRYPTION_KEY.
Plaintext never touches the database; it exists only in memory after decrypt.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

_ENCRYPTED_PREFIX = "enc:v1:"


class EncryptionNotConfigured(RuntimeError):
    """Raised when encrypt/decrypt is attempted without BTX_ENCRYPTION_KEY set."""


def _fernet_key(secret: str) -> bytes:
    # BTX_ENCRYPTION_KEY is an operator-chosen passphrase, not necessarily a
    # valid Fernet key already — derive a stable 32-byte key from it so any
    # non-empty string works (mirrors how e.g. Django's SECRET_KEY is used).
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_value(plaintext: str, *, encryption_key: str | None) -> str:
    """Encrypt *plaintext*, returning a value safe to store in a text column.

    Raises EncryptionNotConfigured if no key is set — callers must not fall
    back to storing plaintext.
    """
    if not encryption_key:
        raise EncryptionNotConfigured("BTX_ENCRYPTION_KEY is required to store credentials.")
    fernet = Fernet(_fernet_key(encryption_key))
    token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _ENCRYPTED_PREFIX + token


def decrypt_value(stored: str, *, encryption_key: str | None) -> str:
    """Decrypt a value produced by encrypt_value. Raises on a bad key or a
    value that was never encrypted (helps catch config mistakes early)."""
    if not stored.startswith(_ENCRYPTED_PREFIX):
        raise ValueError("value is not an encrypted credential (missing enc:v1: prefix)")
    if not encryption_key:
        raise EncryptionNotConfigured("BTX_ENCRYPTION_KEY is required to read credentials.")
    fernet = Fernet(_fernet_key(encryption_key))
    token = stored.removeprefix(_ENCRYPTED_PREFIX)
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("credential could not be decrypted — wrong key or corrupted value") from exc


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_ENCRYPTED_PREFIX)


def decrypt_if_encrypted(value: str | None, *, encryption_key: str | None) -> str | None:
    """Decrypt *value* if it carries the encrypted-value prefix; otherwise
    return it unchanged. Lets legacy plaintext rows (pre-WP10-B, or a local
    dev DB seeded directly) keep working without a forced migration, while
    every value written going forward goes through encrypt_value."""
    if value is None or not is_encrypted(value):
        return value
    return decrypt_value(value, encryption_key=encryption_key)
