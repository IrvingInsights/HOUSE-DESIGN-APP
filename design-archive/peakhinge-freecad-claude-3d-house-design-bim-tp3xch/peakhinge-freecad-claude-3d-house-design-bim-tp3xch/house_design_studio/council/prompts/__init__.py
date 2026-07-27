"""Per-role persona prompts + the shared context builder."""

from ..roles import Role
from . import (
    architect,
    designer_artist,
    natural_building_expert,
    permaculture_homestead_expert,
    project_manager,
    structural_engineer,
)
from ._shared_context import build_shared_context

ROLE_SYSTEM_PROMPTS = {
    Role.architect: architect.SYSTEM_PROMPT,
    Role.structural_engineer: structural_engineer.SYSTEM_PROMPT,
    Role.designer_artist: designer_artist.SYSTEM_PROMPT,
    Role.natural_building_expert: natural_building_expert.SYSTEM_PROMPT,
    Role.permaculture_homestead_expert: permaculture_homestead_expert.SYSTEM_PROMPT,
    Role.project_manager: project_manager.SYSTEM_PROMPT,
}

__all__ = ["ROLE_SYSTEM_PROMPTS", "build_shared_context", "Role"]
