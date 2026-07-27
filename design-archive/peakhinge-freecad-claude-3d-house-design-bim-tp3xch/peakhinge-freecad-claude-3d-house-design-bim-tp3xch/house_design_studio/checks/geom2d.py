"""Minimal 2D geometry helpers for the deterministic checks.

Pure Python, no third-party geometry library — Phase 1 works with axis-aligned
and simply-oriented rectangles, so a compact convex-polygon toolkit is enough.
"""

from __future__ import annotations

from typing import List, Tuple

from .constants import EPSILON_M

Point = Tuple[float, float]


def _sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1])


def _length(v: Point) -> float:
    return (v[0] ** 2 + v[1] ** 2) ** 0.5


def polygon_area(points: List[Point]) -> float:
    """Absolute area of a simple polygon via the shoelace formula."""
    n = len(points)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def wall_rectangle(start: Point, end: Point, thickness: float) -> List[Point]:
    """The four corners of a wall's footprint: its centreline extruded sideways
    by ``thickness / 2`` on each side. Corners are returned counter-clockwise."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = _length((dx, dy))
    if length < EPSILON_M:
        return [start, start, start, start]
    # Unit normal to the centreline.
    nx, ny = -dy / length, dx / length
    half = thickness / 2.0
    ox, oy = nx * half, ny * half
    return [
        (start[0] + ox, start[1] + oy),
        (end[0] + ox, end[1] + oy),
        (end[0] - ox, end[1] - oy),
        (start[0] - ox, start[1] - oy),
    ]


def _signed_area(points: List[Point]) -> float:
    total = 0.0
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        total += x0 * y1 - x1 * y0
    return total / 2.0


def _as_ccw(points: List[Point]) -> List[Point]:
    """Return the polygon oriented counter-clockwise (positive signed area)."""
    return list(points) if _signed_area(points) >= 0 else list(reversed(points))


def convex_intersection_area(poly_a: List[Point], poly_b: List[Point]) -> float:
    """Area of the intersection of two convex polygons (Sutherland-Hodgman).

    Both polygons must be convex; orientation is normalized internally, so
    callers need not pre-order the vertices. Wall footprints are rectangles, so
    this is exact for our use.
    """
    if len(poly_a) < 3 or len(poly_b) < 3:
        return 0.0
    output = _as_ccw(poly_a)
    poly_b = _as_ccw(poly_b)

    def inside(p: Point, a: Point, b: Point) -> bool:
        # True if p is left of / on the directed edge a->b.
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -EPSILON_M

    def intersect(p1: Point, p2: Point, a: Point, b: Point) -> Point:
        # Intersection of segment p1->p2 with the (infinite) line a->b.
        x1, y1 = p1
        x2, y2 = p2
        x3, y3 = a
        x4, y4 = b
        denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(denom) < EPSILON_M:
            return p2
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    n = len(poly_b)
    for i in range(n):
        a, b = poly_b[i], poly_b[(i + 1) % n]
        clipped: List[Point] = []
        if not output:
            break
        prev = output[-1]
        prev_in = inside(prev, a, b)
        for curr in output:
            curr_in = inside(curr, a, b)
            if curr_in:
                if not prev_in:
                    clipped.append(intersect(prev, curr, a, b))
                clipped.append(curr)
            elif prev_in:
                clipped.append(intersect(prev, curr, a, b))
            prev, prev_in = curr, curr_in
        output = clipped
    return polygon_area(output)


def point_to_segment_distance(p: Point, a: Point, b: Point) -> float:
    """Shortest distance from point ``p`` to segment ``a``-``b``."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < EPSILON_M:
        return _length((px - ax, py - ay))
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    proj = (ax + t * dx, ay + t * dy)
    return _length((px - proj[0], py - proj[1]))


def segments_share_endpoint(
    s1: Tuple[Point, Point], s2: Tuple[Point, Point], tol: float
) -> bool:
    """True if two segments meet at (roughly) a shared endpoint — i.e. they are
    adjacent walls at a corner, not an unintended crossing."""
    for p in s1:
        for q in s2:
            if _length(_sub(p, q)) <= tol:
                return True
    return False
