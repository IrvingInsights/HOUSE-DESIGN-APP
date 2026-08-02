"""Prepare user-uploaded images for the Anthropic API.

Pure-Python (Pillow), no network. Resizes to a sane maximum dimension, strips
metadata by re-encoding, and rejects non-images / oversized payloads before they
ever reach the API. Pillow is imported lazily so importing this module never
requires it (the rest of the pipeline must import cleanly without Pillow).
"""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Union

MAX_DIMENSION_PX = 1568  # Anthropic's recommended max long edge.
MAX_INPUT_BYTES = 20 * 1024 * 1024  # reject absurd uploads early.


class ImagePrepError(ValueError):
    pass


def prepare_image_bytes(raw: bytes) -> dict:
    """Return an Anthropic image content block: {type, source{type, media_type,
    data}}. Raises :class:`ImagePrepError` on invalid or oversized input."""
    if not raw:
        raise ImagePrepError("Empty image payload.")
    if len(raw) > MAX_INPUT_BYTES:
        raise ImagePrepError(
            f"Image is {len(raw) // (1024 * 1024)} MB; limit is "
            f"{MAX_INPUT_BYTES // (1024 * 1024)} MB."
        )
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise ImagePrepError(
            "Pillow is required to process images (pip install Pillow)."
        ) from exc

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ImagePrepError(f"Not a readable image: {exc}") from exc

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > MAX_DIMENSION_PX:
        scale = MAX_DIMENSION_PX / longest
        new_size = (round(img.size[0] * scale), round(img.size[1] * scale))
        img = img.resize(new_size)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    data = base64.standard_b64encode(buf.getvalue()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def prepare_image_file(path: Union[str, Path]) -> dict:
    return prepare_image_bytes(Path(path).read_bytes())
