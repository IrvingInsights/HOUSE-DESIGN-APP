"""The six council roles for Phase 1.

The user's original brief listed nine professions. To keep Phase 1 tractable
they are folded into six perspectives without losing coverage:

- "sculptor" is absorbed into Designer/Artist (form, mass, proportion).
- "natural building expert" is its own role.
- "permaculture expert" + "homestead/farm expert" combine into one
  Permaculture / Homestead role (site, sun, water, food systems).

Each role is a persona string in ``prompts/<role>.py``; this module just names
them and defines their canonical order.
"""

from __future__ import annotations

from enum import Enum
from typing import List


class Role(str, Enum):
    architect = "architect"
    structural_engineer = "structural_engineer"
    designer_artist = "designer_artist"
    natural_building_expert = "natural_building_expert"
    permaculture_homestead_expert = "permaculture_homestead_expert"
    project_manager = "project_manager"


def all_roles() -> List[Role]:
    return list(Role)


ROLE_TITLES = {
    Role.architect: "Architect",
    Role.structural_engineer: "Structural / PE-perspective Engineer",
    Role.designer_artist: "Designer / Artist",
    Role.natural_building_expert: "Natural Building Expert",
    Role.permaculture_homestead_expert: "Permaculture / Homestead-Farm Expert",
    Role.project_manager: "Project Manager",
}
