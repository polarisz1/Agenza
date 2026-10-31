"""启动默认值（无副作用：这里的模块被导入时**不会**创建 Settings 单例）。

单独放一个文件的原因：`app/run.py` 需要在写环境变量**之前**拿到默认值，
如果它从 `app.core.config` 导入，就会提前实例化 `Settings`，导致
`--data-dir` / `--port` 这些注入值失效（实测：库写到了 AppData 而不是指定目录）。
"""

from __future__ import annotations

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_LOG_LEVEL = "INFO"
