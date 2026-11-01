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


class ErrorResponse(BaseModel):
    """失败响应信封（评审 G33）。

    与 `ApiResponse` 同构，只是 `data` 可以为空。业务异常（`AppError`）与
    兜底 500 都返回这个形状；此前契约只建模了 200，调用方在 OpenAPI 里
    看不到错误结构，只能靠猜。
    """

    code: int = 400
    message: str = "error"
    data: Any | None = None


# 各 router 统一声明（`APIRouter(responses=ERROR_RESPONSES)`），契约里因此会出现
# 400/404/409/500 的 ErrorResponse。422 仍交给 FastAPI 的 HTTPValidationError，
# 那是请求体反序列化失败，形状是 {"detail": [...]}，不应伪装成业务错误信封。
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "业务错误（参数非法 / 状态不允许）"},
    404: {"model": ErrorResponse, "description": "资源不存在"},
    409: {"model": ErrorResponse, "description": "状态冲突（如同工作流已有运行中实例）"},
    500: {"model": ErrorResponse, "description": "服务端未预期错误"},
}


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
