"""并发保护：同一工作流同时只允许一个 running 的运行（评审 G6）。

"先查再插"在两次请求之间留了窗口，双击"运行"可能起两次。
这里验证数据库层的兜底（部分唯一索引 0002）。
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal, init_db
from app.modules.runs.models import Run


@pytest.fixture(scope="module", autouse=True)
def _schema() -> None:
    """确保测试库已迁移到最新（0002 才有这个部分唯一索引）。"""
    init_db()


def _new_run(run_id: str, wf_id: str, status: str = "running") -> Run:
    return Run(
        id=run_id,
        workflow_id=wf_id,
        workflow_name="并发测试",
        graph_snapshot="{}",
        inputs_json="{}",
        status=status,
    )


def test_second_running_run_is_rejected_by_db() -> None:
    with SessionLocal() as session:
        session.add(_new_run("r_first", "wf_race"))
        session.commit()

    with SessionLocal() as session:
        session.add(_new_run("r_second", "wf_race"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_finished_run_does_not_block_new_one() -> None:
    """索引只覆盖 running：上一次跑完（success）后应当能再起。"""
    with SessionLocal() as session:
        session.add(_new_run("r_done", "wf_done", status="success"))
        session.commit()

    with SessionLocal() as session:
        session.add(_new_run("r_next", "wf_done"))
        session.commit()  # 不应抛错

    with SessionLocal() as session:
        session.query(Run).filter(Run.workflow_id == "wf_done").delete()
        session.commit()


def test_two_workflows_can_run_in_parallel() -> None:
    with SessionLocal() as session:
        session.add_all([_new_run("r_a", "wf_a"), _new_run("r_b", "wf_b")])
        session.commit()

    with SessionLocal() as session:
        session.query(Run).filter(Run.workflow_id.in_(["wf_a", "wf_b"])).delete(
            synchronize_session=False
        )
        session.commit()
