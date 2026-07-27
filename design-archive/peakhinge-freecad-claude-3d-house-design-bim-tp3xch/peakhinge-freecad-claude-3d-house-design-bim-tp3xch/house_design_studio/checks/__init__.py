"""Deterministic checks over GeometryFacts (no FreeCAD, no network)."""

from .report_types import BLOCKING_SEVERITIES, CheckIssue, CheckReport, Severity
from .run_all_checks import run_all_checks

__all__ = [
    "BLOCKING_SEVERITIES",
    "CheckIssue",
    "CheckReport",
    "Severity",
    "run_all_checks",
]
