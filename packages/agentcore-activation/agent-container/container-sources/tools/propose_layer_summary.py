from typing import Any, Dict, List


def propose_layer_summary(layer: str, entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"layer": layer, "entries": entries, "status": "tentative"}
