import os
from typing import Dict


ENV_KEYS = ("THINKWORK_API_URL", "API_AUTH_SECRET", "TENANT_ID")


def snapshot_at_entry() -> Dict[str, str]:
    return {key: os.environ.get(key, "") for key in ENV_KEYS}
