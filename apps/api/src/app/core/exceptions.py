"""Custom exception."""
from __future__ import annotations


class AppException(Exception):
    """Business exception → unified response."""

    def __init__(self, code: int, message: str, data=None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(message)
