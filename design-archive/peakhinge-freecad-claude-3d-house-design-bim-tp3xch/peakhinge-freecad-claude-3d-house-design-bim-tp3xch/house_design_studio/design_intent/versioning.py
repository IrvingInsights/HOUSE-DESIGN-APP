"""Helpers for advancing a Design Intent through revisions."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from .schema import DesignIntent


def bump_revision(intent: DesignIntent) -> DesignIntent:
    """Return a copy of ``intent`` with ``revision`` incremented and
    ``updated_at`` refreshed. The original is left untouched so callers can keep
    prior snapshots for the audit trail."""
    updated = intent.model_copy(deep=True)
    updated.revision = intent.revision + 1
    updated.updated_at = datetime.now(timezone.utc).isoformat()
    return updated


def diff_summary(before: DesignIntent, after: DesignIntent) -> List[str]:
    """Human-readable summary of what changed between two snapshots. Coarse by
    design — it is for the audit report, not a structural merge."""
    lines: List[str] = []

    def _count(label: str, a: int, b: int) -> None:
        if a != b:
            lines.append(f"{label}: {a} -> {b}")

    _count("walls", len(before.walls), len(after.walls))
    _count("openings", len(before.openings), len(after.openings))
    _count("rooms", len(before.rooms), len(after.rooms))

    if before.footprint.model_dump() != after.footprint.model_dump():
        lines.append(
            f"footprint: {before.footprint.width_m}x{before.footprint.depth_m} -> "
            f"{after.footprint.width_m}x{after.footprint.depth_m}"
        )
    if before.roof.model_dump() != after.roof.model_dump():
        lines.append("roof parameters changed")

    before_walls = {w.id: w for w in before.walls}
    for wall in after.walls:
        prev = before_walls.get(wall.id)
        if prev and prev.thickness_m != wall.thickness_m:
            lines.append(
                f"wall {wall.id} thickness: {prev.thickness_m} -> {wall.thickness_m}"
            )

    if not lines:
        lines.append("No structural changes detected between revisions.")
    return lines
