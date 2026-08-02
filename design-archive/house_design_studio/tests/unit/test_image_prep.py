"""Image preparation: resize/encode + guardrails (uses Pillow, no network)."""

import io

import pytest

from house_design_studio.translator.image_prep import (
    MAX_DIMENSION_PX,
    ImagePrepError,
    prepare_image_bytes,
)

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402


def _png_bytes(size=(64, 48), color=(120, 140, 110)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_prepare_returns_base64_jpeg_block():
    block = prepare_image_bytes(_png_bytes())
    assert block["type"] == "image"
    assert block["source"]["media_type"] == "image/jpeg"
    assert isinstance(block["source"]["data"], str) and block["source"]["data"]


def test_oversized_image_is_downscaled():
    block = prepare_image_bytes(_png_bytes(size=(4000, 3000)))
    import base64
    data = base64.b64decode(block["source"]["data"])
    img = Image.open(io.BytesIO(data))
    assert max(img.size) <= MAX_DIMENSION_PX


def test_non_image_rejected():
    with pytest.raises(ImagePrepError):
        prepare_image_bytes(b"this is not an image")


def test_empty_rejected():
    with pytest.raises(ImagePrepError):
        prepare_image_bytes(b"")
