"""Apply a targeted patch to a Design Intent and re-validate.

The revision proposer emits a small JSON-Patch-like list of operations against
the Design Intent (far more auditable than regenerating the whole document).
This module applies them in pure Python and re-validates the result, so a bad
patch fails loudly instead of persisting a broken design.

Path syntax: dotted with optional list indices, e.g.
    ``walls[3].thickness_m``      -> the thickness of the 4th wall
    ``openings``                   -> the openings list (target for 'add')
    ``footprint.wall_height_m``    -> a nested scalar

Operations:
    set    — set the value at ``path`` (scalar, object, or list element)
    add    — append ``value`` to the list at ``path``
    remove — delete the list element at ``path`` (path must end in an index)
"""

from __future__ import annotations

import re
from typing import Any, List, Tuple

from pydantic import BaseModel, Field

from ..design_intent.schema import DesignIntent

_TOKEN_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(?:\[(-?\d+)\])?$")


class PatchOp(BaseModel):
    path: str
    op: str = Field(..., description="set | add | remove")
    value: Any = None


class PatchError(ValueError):
    pass


def _parse_path(path: str) -> List[Tuple[str, Any]]:
    tokens: List[Tuple[str, Any]] = []
    for raw in path.split("."):
        m = _TOKEN_RE.match(raw.strip())
        if not m:
            raise PatchError(f"Un-parseable path segment: '{raw}' in '{path}'.")
        name, index = m.group(1), m.group(2)
        tokens.append((name, int(index) if index is not None else None))
    return tokens


def _descend(container: Any, name: str, index: Any) -> Any:
    if isinstance(container, dict):
        if name not in container:
            raise PatchError(f"Key '{name}' not present.")
        node = container[name]
    else:
        raise PatchError(f"Cannot descend into non-object for '{name}'.")
    if index is not None:
        if not isinstance(node, list):
            raise PatchError(f"'{name}' is not a list but was indexed.")
        try:
            return node[index]
        except IndexError as exc:
            raise PatchError(f"Index {index} out of range for '{name}'.") from exc
    return node


def _apply_one(data: dict, op: PatchOp) -> None:
    tokens = _parse_path(op.path)
    if not tokens:
        raise PatchError("Empty patch path.")

    # Navigate to the container holding the final token.
    node: Any = data
    for name, index in tokens[:-1]:
        node = _descend(node, name, index)

    last_name, last_index = tokens[-1]

    if op.op == "set":
        target = _descend(node, last_name, None)  # ensure key exists
        if last_index is not None:
            if not isinstance(target, list):
                raise PatchError(f"'{last_name}' is not a list but was indexed.")
            target[last_index] = op.value
        else:
            if not isinstance(node, dict):
                raise PatchError("Cannot set on a non-object parent.")
            node[last_name] = op.value
    elif op.op == "add":
        target = _descend(node, last_name, last_index)
        if not isinstance(target, list):
            raise PatchError(f"'add' target '{op.path}' is not a list.")
        target.append(op.value)
    elif op.op == "remove":
        if last_index is None:
            if isinstance(node, dict) and last_name in node:
                del node[last_name]
            else:
                raise PatchError(f"Cannot remove '{op.path}'.")
        else:
            target = _descend(node, last_name, None)
            if not isinstance(target, list):
                raise PatchError(f"'remove' target '{last_name}' is not a list.")
            try:
                del target[last_index]
            except IndexError as exc:
                raise PatchError(f"Index {last_index} out of range.") from exc
    else:
        raise PatchError(f"Unknown op '{op.op}'.")


def apply_patch(intent: DesignIntent, ops: List[PatchOp]) -> DesignIntent:
    """Return a new, re-validated DesignIntent with ``ops`` applied. Raises
    :class:`PatchError` (or Pydantic ValidationError) if the result is invalid;
    the caller keeps the prior snapshot in that case."""
    data = intent.model_dump(mode="json")
    for op in ops:
        _apply_one(data, op)
    return DesignIntent.model_validate(data)
