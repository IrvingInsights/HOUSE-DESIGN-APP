"""Translator turns a brief into a validated DesignIntent via the LLM client."""

import json
from pathlib import Path

import pytest

from house_design_studio.design_intent import DesignIntent
from house_design_studio.llm.client import ScriptedClient
from house_design_studio.translator.translate import TranslationError, translate_brief

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def _client_returning_sample():
    intent_dict = json.loads(SAMPLE.read_text(encoding="utf-8"))
    return ScriptedClient(by_schema={"design_intent": intent_dict})


def test_translate_text_returns_valid_intent():
    intent = translate_brief("a small cabin", None, _client_returning_sample())
    assert isinstance(intent, DesignIntent)
    assert intent.revision == 1


def test_translate_requires_some_input():
    with pytest.raises(TranslationError):
        translate_brief(None, None, _client_returning_sample())


def test_translate_wraps_invalid_model_output():
    client = ScriptedClient(by_schema={"design_intent": {"footprint": {"width_m": 8}}})
    with pytest.raises(TranslationError):
        translate_brief("x", None, client)
