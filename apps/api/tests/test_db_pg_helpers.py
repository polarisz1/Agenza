"""DB-03：PostgreSQL 迁移辅助类型测试。"""

from sqlalchemy.dialects import postgresql, sqlite

from app.db.pg import jsonb_type, uuid_type


def _compiled(type_, dialect) -> str:
    return str(type_.compile(dialect=dialect))


def test_uuid_type_uses_native_uuid_on_postgres() -> None:
    assert "UUID" in _compiled(uuid_type(), postgresql.dialect())


def test_uuid_type_falls_back_to_char_on_sqlite() -> None:
    assert "CHAR" in _compiled(uuid_type(), sqlite.dialect())


def test_jsonb_type_uses_jsonb_on_postgres() -> None:
    assert "JSONB" in _compiled(jsonb_type(), postgresql.dialect())


def test_jsonb_type_falls_back_to_json_on_sqlite() -> None:
    assert "JSON" in _compiled(jsonb_type(), sqlite.dialect())
