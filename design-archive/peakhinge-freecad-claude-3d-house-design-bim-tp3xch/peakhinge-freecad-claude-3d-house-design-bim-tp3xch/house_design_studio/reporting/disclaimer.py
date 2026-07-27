"""The single source of truth for the PE / professional-review disclaimer.

This text is imported everywhere the disclaimer must appear (the report, the API
metadata, the frontend). A unit test asserts it is present in every generated
report so it can never be dropped silently.
"""

PE_DISCLAIMER = (
    "IMPORTANT — NOT A STAMPED ENGINEERING DOCUMENT.\n\n"
    "This package is PE-review-*ready* documentation produced by software. It is "
    "NOT a substitute for professional design services and it carries NO "
    "engineering or architectural certification. No software can issue a valid "
    "Professional Engineer (PE) stamp; only a licensed Professional Engineer (and, "
    "where required, a licensed Architect) can review this design, perform the "
    "required calculations, and apply their seal, taking on the associated "
    "professional liability.\n\n"
    "All structural notes here are heuristic sanity checks (rules of thumb), not "
    "engineered calculations. All code-related checks are non-authoritative and are "
    "not tied to any specific adopted building code or jurisdiction. Before this "
    "design is built, a licensed professional must independently verify every "
    "assumption, dimension, load path, and code requirement against the applicable "
    "codes and site conditions."
)

DISCLAIMER_TITLE = "Professional Review Required"
