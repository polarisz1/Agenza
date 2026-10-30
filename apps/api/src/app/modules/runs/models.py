"""Run module."""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.db.database import Base


class Run(Base):
    __tablename__ = "run"

    id = Column(String(12), primary_key=True, index=True)
    workflow_id = Column(String(12), index=True)
    workflow_name = Column(String(200))
    graph_snapshot = Column(Text, nullable=False)
    inputs_json = Column(Text, nullable=True)
    status = Column(String(20), default="running")  # running | success | failed | cancelled
    trigger = Column(String(20), default="manual")  # manual | debug | scheduled
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    total_tokens = Column(Integer, default=0)


class NodeRun(Base):
    __tablename__ = "node_run"

    id = Column(String(16), primary_key=True)
    run_id = Column(String(12), index=True)
    node_id = Column(String(24))
    node_type = Column(String(30))
    node_name = Column(String(200))
    status = Column(String(20))
    attempt = Column(Integer, default=1)
    started_at = Column(DateTime, nullable=True, index=True)
    finished_at = Column(DateTime, nullable=True)
    input_json = Column(Text, nullable=True)
    output_json = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    model = Column(String(100), nullable=True)
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)
