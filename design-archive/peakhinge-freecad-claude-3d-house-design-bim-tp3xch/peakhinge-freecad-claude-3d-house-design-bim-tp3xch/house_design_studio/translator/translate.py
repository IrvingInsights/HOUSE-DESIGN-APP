"""Turn a text + image brief into a validated DesignIntent via the LLM client."""

from __future__ import annotations

from typing import List, Optional

from ..design_intent.schema import DesignIntent
from ..llm.client import LLMClient
from .prompts import TRANSLATOR_SYSTEM


class TranslationError(RuntimeError):
    pass


def _design_intent_schema() -> dict:
    return DesignIntent.model_json_schema()


def translate_brief(
    text: Optional[str],
    image_blocks: Optional[List[dict]],
    client: LLMClient,
) -> DesignIntent:
    """image_blocks are already-prepared Anthropic image content blocks (see
    :mod:`translator.image_prep`). Returns a validated DesignIntent or raises
    :class:`TranslationError`."""
    if not text and not image_blocks:
        raise TranslationError("Provide a text description and/or at least one image.")

    content: list = list(image_blocks or [])
    content.append(
        {
            "type": "text",
            "text": (text or "Design a house based on the attached image(s).")
            + "\n\nReturn a complete Design Intent conforming to the schema.",
        }
    )

    try:
        result = client.complete_json(
            system=TRANSLATOR_SYSTEM,
            content=content,
            schema=_design_intent_schema(),
            schema_name="design_intent",
        )
    except Exception as exc:  # noqa: BLE001
        raise TranslationError(f"LLM translation failed: {exc}") from exc

    try:
        intent = DesignIntent.model_validate(result)
    except Exception as exc:  # noqa: BLE001
        raise TranslationError(
            f"Model output did not validate against the Design Intent schema: {exc}"
        ) from exc

    # The translator always produces revision 1.
    intent.revision = 1
    return intent
