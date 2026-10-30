"""Network helpers - 本地地址不走系统代理。"""
from __future__ import annotations

from urllib.parse import urlparse

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def is_local_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in _LOCAL_HOSTS or host.startswith("127.")


def trust_env_for(url: str) -> bool:
    """本地地址禁用环境代理，避免本机请求被公司代理拦截成 502。"""
    return not is_local_url(url)
