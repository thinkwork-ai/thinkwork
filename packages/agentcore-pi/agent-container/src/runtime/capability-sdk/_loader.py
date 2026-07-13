"""Load the SDK modules by file path.

The SDK lives in a hyphenated directory (``capability-sdk``) that is not a valid
Python package identifier, so the test modules import the SDK sources directly by
path and register them under their flat names (``canonical``, ``ed25519``,
``client``) so ``client``'s flat-import fallback resolves.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
from types import ModuleType

_HERE = pathlib.Path(__file__).resolve().parent


def _load(name: str) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _HERE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # register first so intra-SDK imports resolve
    spec.loader.exec_module(module)
    return module


def load_sdk() -> tuple[ModuleType, ModuleType, ModuleType]:
    canonical = _load("canonical")
    ed25519 = _load("ed25519")
    client = _load("client")
    return canonical, ed25519, client


def vectors_path() -> pathlib.Path:
    return _HERE / "shared-vectors.json"
