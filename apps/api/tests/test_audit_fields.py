"""DB-05：统一审计字段与工作流软删除。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.db.database import Base, SessionLocal
from app.main import app
from app.modules.workflows.models import Workflow

GRAPH = {
    "version": 1,
    "inputs": [],
    "nodes": [
        {
            "id": "in",
            "type": "input",
            "name": "输入1",
            "position": {"x": 0, "y": 0},
            "config": {"key": "text"},
        }
    ],
    "edges": [],
}


def test_all_business_tables_have_audit_columns() -> None:
    required = {"created_by", "updated_by", "deleted_at"}
    business_tables = [
        "user",
        "workspace",
        "workspace_member",
        "api_key",
        "workflow",
        "workflow_version",
        "run",
        "node_run",
        "provider",
        "app_setting",
    ]
    for table_name in business_tables:
        columns = set(Base.metadata.tables[table_name].columns.keys())
        missing = required - columns
        assert not missing, f"{table_name} missing {missing}"


def test_workflow_delete_is_soft_delete() -> None:
    with TestClient(app) as client:
        created = client.post("/api/workflows", json={"name": "软删除用例", "graph": GRAPH})
        assert created.status_code == 200, created.text
        wf_id = created.json()["data"]["id"]

        deleted = client.delete(f"/api/workflows/{wf_id}?confirm=true")
        assert deleted.status_code == 200, deleted.text

        # 列表与详情不再返回
        listed = client.get("/api/workflows")
        assert listed.status_code == 200, listed.text
        ids = [item["id"] for item in listed.json()["data"]["items"]]
        assert wf_id not in ids
        assert client.get(f"/api/workflows/{wf_id}").status_code == 404

        # 数据库行仍在，deleted_at 已写入
        with SessionLocal() as session:
            row = session.get(Workflow, wf_id)
            assert row is not None
            assert row.deleted_at is not None
