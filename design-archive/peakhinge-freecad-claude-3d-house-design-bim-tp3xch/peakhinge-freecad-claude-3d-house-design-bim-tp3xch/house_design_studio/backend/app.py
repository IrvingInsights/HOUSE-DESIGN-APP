"""FastAPI application factory for House Design Studio."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Config
from .job_manager import JobManager
from .routes import design_intent_routes, job_routes

_FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.from_env()
    client = config.build_llm_client()

    app = FastAPI(title="House Design Studio", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.config = config
    app.state.job_manager = JobManager(config, client)

    app.include_router(design_intent_routes.router)
    app.include_router(job_routes.router)

    @app.get("/api/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "dev_mode_freecad": config.force_dev_mode,
            "mock_claude": config.mock_claude,
            "max_iterations": config.max_iterations,
        }

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(str(_FRONTEND_DIR / "index.html"))

    if _FRONTEND_DIR.exists():
        app.mount(
            "/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static"
        )
    return app


# Module-level app for `uvicorn house_design_studio.backend.app:app`.
# Guarded so importing this module for tests doesn't require env/config to be
# valid (tests build their own app with an injected config).
app = None
try:  # pragma: no cover - convenience for the uvicorn entrypoint
    app = create_app()
except Exception:  # noqa: BLE001
    app = None
