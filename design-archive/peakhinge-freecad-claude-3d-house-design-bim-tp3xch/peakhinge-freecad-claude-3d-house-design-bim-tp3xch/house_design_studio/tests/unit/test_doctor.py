"""Doctor: .env parse/write, FreeCAD auto-detect, readiness report."""

import os

import pytest

from house_design_studio.backend import doctor


def test_parse_env_ignores_comments_and_blanks(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "# a comment\n\nANTHROPIC_API_KEY=sk-123\n"
        "# HDS_FREECAD_CMD=C:/nope\nHDS_MAX_ITERATIONS=3\n",
        encoding="utf-8",
    )
    values = doctor.parse_env_file(env)
    assert values == {"ANTHROPIC_API_KEY": "sk-123", "HDS_MAX_ITERATIONS": "3"}


def test_set_env_value_adds_then_updates(tmp_path):
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=old\n", encoding="utf-8")

    doctor.set_env_value(env, "ANTHROPIC_API_KEY", "new")
    assert doctor.parse_env_file(env)["ANTHROPIC_API_KEY"] == "new"

    doctor.set_env_value(env, "HDS_MAX_ITERATIONS", "4")
    parsed = doctor.parse_env_file(env)
    assert parsed["HDS_MAX_ITERATIONS"] == "4"
    assert parsed["ANTHROPIC_API_KEY"] == "new"  # untouched


def test_set_env_value_activates_commented_template(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# HDS_FREECAD_CMD=C:/example\n", encoding="utf-8")
    doctor.set_env_value(env, "HDS_FREECAD_CMD", "C:/real/FreeCADCmd.exe")
    parsed = doctor.parse_env_file(env)
    assert parsed["HDS_FREECAD_CMD"] == "C:/real/FreeCADCmd.exe"


def test_ensure_env_file_creates_from_example(tmp_path, monkeypatch):
    target = tmp_path / ".env"
    monkeypatch.setattr(doctor, "ENV_EXAMPLE_PATH", tmp_path / "template")
    (tmp_path / "template").write_text("ANTHROPIC_API_KEY=\n", encoding="utf-8")
    doctor.ensure_env_file(target)
    assert target.exists()


def test_detect_and_persist_freecad_writes_when_found(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("", encoding="utf-8")
    monkeypatch.delenv("HDS_FREECAD_CMD", raising=False)
    fake_path = str(tmp_path / "FreeCADCmd")
    (tmp_path / "FreeCADCmd").write_text("", encoding="utf-8")

    result = doctor.detect_and_persist_freecad(env, probe=lambda _explicit: fake_path)
    assert result == fake_path
    assert doctor.parse_env_file(env)["HDS_FREECAD_CMD"] == fake_path


def test_detect_and_persist_freecad_none_when_missing(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("", encoding="utf-8")
    monkeypatch.delenv("HDS_FREECAD_CMD", raising=False)
    result = doctor.detect_and_persist_freecad(env, probe=lambda _explicit: None)
    assert result is None
    assert "HDS_FREECAD_CMD" not in doctor.parse_env_file(env)


def test_readiness_report_reflects_state(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    fake = tmp_path / "FreeCADCmd"
    fake.write_text("", encoding="utf-8")
    env.write_text(
        f"ANTHROPIC_API_KEY=sk-xyz\nHDS_FREECAD_CMD={fake}\n", encoding="utf-8"
    )
    for k in ("ANTHROPIC_API_KEY", "HDS_FREECAD_CMD", "HDS_DATA_DIR",
              "HDS_DEV_MODE_MOCK_CLAUDE"):
        monkeypatch.delenv(k, raising=False)

    report = doctor.readiness_report(env)
    assert report["api_key_set"] is True
    assert report["freecad_found"] is True
    assert report["freecad_path"] == str(fake)


def test_load_env_into_environ_does_not_clobber(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=from_file\n", encoding="utf-8")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from_env")
    doctor.load_env_into_environ(env)
    assert os.environ["ANTHROPIC_API_KEY"] == "from_env"  # real env wins
