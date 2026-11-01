"""契约形状回归（G33 / G5 / G19）。

这三项都是"代码在跑、但对外契约不完整"的问题，只能在 OpenAPI 产物层面断言：
- 错误响应必须有 schema（此前只建模了 200，调用方看不到 {code,message,data}）
- 双运行入口里的旧入口必须标 deprecated（D-2 的落地方式）
- `.env` 必须按绝对路径加载（相对 cwd 在打包/不同启动方式下会静默失效）
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import ENV_FILE, ROOT_DIR, Settings, settings
from app.main import app


def test_error_response_is_modelled_for_every_business_status() -> None:
    spec = app.openapi()
    assert "ErrorResponse" in spec["components"]["schemas"]

    operation = spec["paths"]["/api/workflows"]["get"]
    for code in ("400", "404", "409", "500"):
        schema = operation["responses"][code]["content"]["application/json"]["schema"]
        assert schema["$ref"].endswith("/ErrorResponse"), code

    # 422 仍是 FastAPI 的校验错误形状，不能被伪装成业务信封
    assert operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/HTTPValidationError"
    )


def test_error_body_matches_error_response_schema() -> None:
    with TestClient(app) as client:
        response = client.get("/api/runs/run_does_not_exist")

    assert response.status_code == 404
    body = response.json()
    assert set(body) == {"code", "message", "data"}
    assert body["code"] == 404
    assert body["message"]


def test_framework_404_uses_the_same_envelope() -> None:
    """未知路由不能返回 {"detail": ...}：前端按 {code,message,data} 解包。"""
    with TestClient(app) as client:
        response = client.get("/api/definitely-not-a-route")

    assert response.status_code == 404
    body = response.json()
    assert set(body) == {"code", "message", "data"}
    assert body["code"] == 404


def test_legacy_run_entry_is_marked_deprecated() -> None:
    operation = app.openapi()["paths"]["/api/runs"]["post"]

    assert operation.get("deprecated") is True
    # 说明里要指向新入口，否则前端不知道该迁到哪
    assert "/api/workflows/{wf_id}/runs" in operation.get("description", "")


def test_env_file_is_absolute_and_points_to_apps_api() -> None:
    assert ENV_FILE.is_absolute()
    assert ENV_FILE == ROOT_DIR / "apps" / "api" / ".env"

    configured = Settings.model_config["env_file"]
    assert isinstance(configured, tuple)
    assert str(ENV_FILE) in configured
    # 除绝对路径外只允许 cwd 的 .env 作为低优先级兜底，绝不能再是唯一来源
    assert configured[-1] == str(ENV_FILE)
    assert settings.DATA_DIR  # 加载配置本身不应抛错
