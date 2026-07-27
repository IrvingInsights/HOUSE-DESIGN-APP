"""A thin, injectable wrapper over the Anthropic API.

Every LLM-touching stage (translator, council, synthesizer, revision proposer)
depends on the small :class:`LLMClient` protocol below rather than on the
Anthropic SDK directly. Two implementations are provided:

- :class:`AnthropicClient` — the real thing, used on a machine with
  ``ANTHROPIC_API_KEY`` set.
- :class:`ScriptedClient` — returns canned responses; used by unit tests and by
  the ``HDS_DEV_MODE_MOCK_CLAUDE`` flag so the entire pipeline runs offline.

The ``complete_json`` method asks the model for a single JSON object matching a
provided JSON Schema and returns the parsed ``dict``. Keeping structured output
behind one method means the SDK's exact tool-use / structured-output surface is
isolated to one place and easy to adapt as the SDK evolves.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Protocol

# Model ids are centralised so a single edit re-points every stage.
DEFAULT_MODEL = "claude-opus-4-8"

# A message content block is either a plain string or an Anthropic content list.
Content = Any


class LLMClient(Protocol):
    def complete_json(
        self,
        *,
        system: str,
        content: Content,
        schema: Dict[str, Any],
        schema_name: str,
        max_tokens: int = 8000,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return a dict guaranteed to conform to ``schema`` (a JSON Schema)."""
        ...


class AnthropicClient:
    """Real Anthropic-backed client. Imports the SDK lazily so that importing
    this module never requires ``anthropic`` to be installed (tests and dev mode
    use :class:`ScriptedClient` and must not need the SDK)."""

    def __init__(self, api_key: Optional[str] = None, model: str = DEFAULT_MODEL):
        try:
            import anthropic  # noqa: F401
        except ImportError as exc:  # pragma: no cover - exercised only on real runs
            raise RuntimeError(
                "The 'anthropic' package is required for live runs. Install it "
                "(pip install anthropic) or run with HDS_DEV_MODE_MOCK_CLAUDE=1."
            ) from exc
        from anthropic import Anthropic

        self._client = Anthropic(api_key=api_key)
        self._model = model

    def complete_json(
        self,
        *,
        system: str,
        content: Content,
        schema: Dict[str, Any],
        schema_name: str,
        max_tokens: int = 8000,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Structured output via a single forced tool call. This is the most
        # widely-supported way to get schema-valid JSON across SDK versions.
        tool = {
            "name": schema_name,
            "description": f"Return a {schema_name} object.",
            "input_schema": schema,
        }
        message = self._client.messages.create(
            model=model or self._model,
            max_tokens=max_tokens,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": schema_name},
            messages=[{"role": "user", "content": content}],
        )
        for block in message.content:
            if getattr(block, "type", None) == "tool_use" and block.name == schema_name:
                return dict(block.input)
        raise RuntimeError(
            f"Model did not return the expected '{schema_name}' tool call."
        )


class ScriptedClient:
    """Deterministic client for tests and offline dev mode.

    Provide either a list of responses (consumed in order) or a callable that
    maps ``schema_name`` -> dict. Any un-scripted call raises, so tests fail
    loudly rather than silently returning empty data.
    """

    def __init__(
        self,
        responses: Optional[List[Dict[str, Any]]] = None,
        by_schema: Optional[Dict[str, Any]] = None,
    ):
        self._responses = list(responses or [])
        self._by_schema = by_schema or {}
        self.calls: List[Dict[str, Any]] = []

    def complete_json(
        self,
        *,
        system: str,
        content: Content,
        schema: Dict[str, Any],
        schema_name: str,
        max_tokens: int = 8000,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        self.calls.append({"schema_name": schema_name, "system": system})
        if schema_name in self._by_schema:
            handler = self._by_schema[schema_name]
            result = handler(content) if callable(handler) else handler
            return json.loads(json.dumps(result))  # defensive deep copy
        if self._responses:
            return self._responses.pop(0)
        raise RuntimeError(
            f"ScriptedClient has no scripted response for schema '{schema_name}'."
        )
