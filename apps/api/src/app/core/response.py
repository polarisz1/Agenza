"""Unified response helpers."""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse[T](BaseModel):
    """统一响应信封 - 作为 FastAPI response_model 的单一事实源。"""

    code: int = 200
    message: str = "ok"
    data: T


class DeleteResult(BaseModel):
    deleted: bool = True


class CancelResult(BaseModel):
    cancelled: bool = False


class ClearResult(BaseModel):
    cleared: int = 0


def success(data: Any = None, message: str = "ok", code: int = 200) -> dict:
    return {"code": code, "message": message, "data": data}


def error(message: str = "error", code: int = 400, data: Any = None) -> dict:
    resp = {"code": code, "message": message}
    if data is not None:
        resp["data"] = data
    return resp


def paginate(items: list, total: int, page: int = 1, page_size: int = 20) -> dict:
    return {
        "code": 200,
        "message": "ok",
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if page_size else 0,
        },
    }
