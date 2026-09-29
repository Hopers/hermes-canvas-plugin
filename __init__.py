"""hermes-canvas agent half.

The heavy lifting lives in dashboard/plugin_api.py (canvas content served
over the plugin REST namespace). This package init registers no tools or
hooks — the plugin exists to carry the desktop half plus this backend
route — but it still exposes register() to satisfy the loader contract.
"""
from __future__ import annotations

from typing import Any


def register(ctx: Any) -> None:
    """No-op registration: no tools, no hooks (backend route is declarative)."""
    return None
