"""Runtime configuration and dependency wiring for the backend.

Reads environment variables once and builds the LLM client + builder the rest of
the app uses. Three modes:

- Normal: real Anthropic client (needs ANTHROPIC_API_KEY) + FreeCAD if present.
- ``HDS_DEV_MODE_SKIP_FREECAD=1``: force the pure-Python dev builder.
- ``HDS_DEV_MODE_MOCK_CLAUDE=1``: use a scripted LLM client so the whole
  pipeline runs offline with no API key (for demos and CI).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..llm.client import AnthropicClient, LLMClient, ScriptedClient


def _bool_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def build_demo_client() -> ScriptedClient:
    """A scripted client that lets the full pipeline run offline.

    The council raises no concerns and the synthesizer returns no action items,
    so the loop converges on iteration 1 driven purely by the deterministic
    checks. Honest for a demo: "no blocking issues found; converged."
    """
    def expert(_content):
        return {"findings": []}

    def synth(_content):
        return {
            "summary": "Offline demo mode: expert council not called; "
            "only automated checks were run.",
            "action_items": [],
        }

    def proposal(_content):
        return {"rationale": "no change", "patch": []}

    return ScriptedClient(
        by_schema={
            "expert_findings": expert,
            "synthesis_report": synth,
            "revision_proposal": proposal,
            # If translation is attempted in demo mode without a canned intent,
            # fail loudly rather than fabricate a house.
        }
    )


@dataclass
class Config:
    data_dir: Path
    max_iterations: int
    force_dev_mode: bool
    mock_claude: bool
    freecad_cmd: str | None
    anthropic_api_key: str | None

    @classmethod
    def from_env(cls) -> "Config":
        data_dir = Path(
            os.getenv("HDS_DATA_DIR")
            or (Path(__file__).resolve().parents[1] / "jobs")
        )
        return cls(
            data_dir=data_dir,
            max_iterations=int(os.getenv("HDS_MAX_ITERATIONS", "5")),
            force_dev_mode=_bool_env("HDS_DEV_MODE_SKIP_FREECAD"),
            mock_claude=_bool_env("HDS_DEV_MODE_MOCK_CLAUDE"),
            freecad_cmd=os.getenv("HDS_FREECAD_CMD") or None,
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        )

    def build_llm_client(self) -> LLMClient:
        if self.mock_claude:
            return build_demo_client()
        if not self.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Set it, or run with "
                "HDS_DEV_MODE_MOCK_CLAUDE=1 for an offline demo."
            )
        return AnthropicClient(api_key=self.anthropic_api_key)
