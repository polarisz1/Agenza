"""Back-end tests conftest."""

from __future__ import annotations

import sys
from pathlib import Path

# Import apps/api/src/app as `app`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
