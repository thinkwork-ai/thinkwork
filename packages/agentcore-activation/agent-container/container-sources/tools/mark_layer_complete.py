from datetime import datetime, timezone
from typing import Any, Dict


def mark_layer_complete(layer: str, state: Dict[str, Any], empty: bool = False) -> Dict[str, Any]:
    return {
        "layer": layer,
        "status": "confirmed_empty" if empty else "confirmed",
        "checkpointed_at": datetime.now(timezone.utc).isoformat(),
        **state,
    }
