"""异常 → 可读错误文本（v0.1.1 / PRD B2）。

背景：某些异常的消息是空字符串（典型例子是 Windows SelectorEventLoop 上的
`NotImplementedError`）。此前 `str(exc)` 会把它们变成空错误，前端只能显示一句
`Run failed`，用户完全无法定位。这里统一兜底为"异常类型 + 说明"。
"""

from __future__ import annotations


def describe_exception(exc: BaseException) -> str:
    """把异常转成非空的用户可读文本。

    - 有消息：保持原样（大多数业务错误已经是中文可读文案）
    - 无消息：退回异常类型名，明确告诉用户"这是内部错误，且不是空"
    """
    message = str(exc).strip()
    if message:
        return message
    return f"{type(exc).__name__}（无错误信息）"
