from typing import Any, Dict


def propose_bundle_entry(layer: str, target: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    if layer == "friction" and target == "wiki":
        raise ValueError("friction-layer entries can only target private memory")
    return {"layer": layer, "target": target, "entry": entry}
