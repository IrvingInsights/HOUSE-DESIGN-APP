"""Every numeric threshold used by the deterministic checks lives here.

IMPORTANT — READ THIS BEFORE TRUSTING ANY NUMBER BELOW.

All values in this file are general rules of thumb, gathered to catch obvious
mistakes early. They are NOT code-compliant, NOT jurisdiction-specific, and NOT
a substitute for engineering. Every check that uses them marks its findings
``heuristic=True`` and the final report repeats this caveat. A licensed design
professional must verify all of these against the applicable building code.
"""

# --- Geometric tolerances (exact checks, not heuristics) ------------------- #
EPSILON_M = 1e-6
# How far an opening/edge may miss a wall before we call it a real error.
POSITION_TOLERANCE_M = 0.02
# Minimum overlap area (m^2) between two wall footprints before we flag a clash.
WALL_OVERLAP_MIN_AREA_M2 = 1e-4
# A roof must cover at least this fraction of the footprint (overhang -> >1 is fine).
ROOF_MIN_COVERAGE_RATIO = 0.98

# --- Habitability heuristics ----------------------------------------------- #
# ~7'-0"; commonly cited minimum habitable ceiling height.
MIN_HABITABLE_CEILING_HEIGHT_M = 2.13

# Bedroom emergency egress opening rules of thumb (IRC-inspired, NOT authoritative).
MIN_EGRESS_CLEAR_WIDTH_M = 0.51   # ~20 in
MIN_EGRESS_CLEAR_HEIGHT_M = 0.61  # ~24 in
MIN_EGRESS_CLEAR_AREA_M2 = 0.53   # ~5.7 sq ft
MAX_EGRESS_SILL_HEIGHT_M = 1.12   # ~44 in

# --- Structural sanity heuristics ------------------------------------------ #
# Span-to-depth: a member spanning more than DEPTH * this ratio is flagged as
# likely under-depth. ~L/20 is a conservative rule of thumb for wood bending
# members; this is a smell test only, never a design calculation.
MAX_SPAN_TO_DEPTH_RATIO = 20.0
# Fallback nominal member depth (m) when framing text cannot be parsed (~2x8).
FALLBACK_MEMBER_DEPTH_M = 0.184
