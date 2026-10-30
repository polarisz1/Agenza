"""Back-end tests conftest. / 后端测试全局配置。"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Import apps/api/src/app as `app`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

# 必须在导入 app.core.config 之前落定：测试不要把库/密钥写进仓库的 apps/data，
# 同时关掉 SQL echo（DEBUG=True 会让每个用例刷屏）。
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="agentflow_test_"))
os.environ.setdefault("DEBUG", "false")
