"""Run every deterministic check and assemble a single CheckReport."""

from __future__ import annotations

from ..bim_builder.geometry_facts import GeometryFacts
from ..design_intent.schema import DesignIntent
from .geometry_checks import run_geometry_checks
from .heuristic_checks import run_heuristic_checks
from .report_types import CheckReport


def run_all_checks(facts: GeometryFacts, intent: DesignIntent) -> CheckReport:
    report = CheckReport(revision=intent.revision)
    report.extend(run_geometry_checks(facts))
    report.extend(run_heuristic_checks(facts, intent))
    return report
