from datetime import datetime, timezone
from typing import Dict


def dismiss_recommendation(item_id: str) -> Dict[str, str]:
    return {"item_id": item_id, "status": "dismissed", "dismissed_at": datetime.now(timezone.utc).isoformat()}
