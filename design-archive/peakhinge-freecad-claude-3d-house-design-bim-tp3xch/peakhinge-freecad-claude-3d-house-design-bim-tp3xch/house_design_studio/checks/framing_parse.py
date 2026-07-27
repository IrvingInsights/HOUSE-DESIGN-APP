"""Parse free-text structural framing notes into a nominal member depth.

The Design Intent stores framing as free text (e.g. "2x8 rafters @ 16in o.c.").
The span-to-depth heuristic needs a member depth in metres. This maps common
nominal dimensional-lumber callouts to their *actual* dressed depths. It is a
convenience for a sanity check only — never a substitute for a real member
schedule.
"""

from __future__ import annotations

import re
from typing import Optional

from .constants import FALLBACK_MEMBER_DEPTH_M

# Nominal callout -> actual dressed depth in metres (US dimensional lumber).
_NOMINAL_ACTUAL_DEPTH_M = {
    "2x4": 0.089,
    "2x6": 0.140,
    "2x8": 0.184,
    "2x10": 0.235,
    "2x12": 0.286,
    "2x14": 0.335,
}

_CALLOUT_RE = re.compile(r"\b(2\s*[xX]\s*(?:4|6|8|10|12|14))\b")


def parse_member_depth_m(text: str) -> Optional[float]:
    """Return the deepest lumber depth mentioned in ``text``, or ``None`` if no
    recognizable callout is present."""
    if not text:
        return None
    depths = []
    for match in _CALLOUT_RE.finditer(text):
        key = match.group(1).replace(" ", "").lower()
        if key in _NOMINAL_ACTUAL_DEPTH_M:
            depths.append(_NOMINAL_ACTUAL_DEPTH_M[key])
    if not depths:
        return None
    return max(depths)


def parse_member_depth_or_fallback(text: str) -> tuple[float, bool]:
    """Return ``(depth_m, was_parsed)``. Falls back to a conservative default
    depth when the text can't be parsed, flagging lower confidence."""
    depth = parse_member_depth_m(text)
    if depth is None:
        return FALLBACK_MEMBER_DEPTH_M, False
    return depth, True


def mentions_slab(text: str) -> bool:
    return "slab" in (text or "").lower()
