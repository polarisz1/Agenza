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


def pytest_configure(config) -> None:
    """Windows 上屏蔽 TestClient 事件循环收尾时的 proactor 传输析构噪声。

    这是测试框架拆 loop 的产物（unclosed transport），不是应用逻辑问题；
    只在 Windows 生效，Linux/CI 仍保留完整可见性。真实异常依旧会让用例失败。
    """
    if sys.platform == "win32":
        config.addinivalue_line("filterwarnings", "ignore::pytest.PytestUnraisableExceptionWarning")
