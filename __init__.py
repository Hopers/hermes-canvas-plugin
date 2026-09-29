"""hermes-canvas agent half.

The heavy lifting lives in dashboard/plugin_api.py (canvas content served
over the plugin REST namespace). This package init intentionally registers
no tools/hooks — the plugin exists to carry the desktop half plus this
backend route.
"""
