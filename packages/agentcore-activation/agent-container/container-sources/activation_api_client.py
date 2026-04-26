import json
from typing import Any, Dict
from urllib import request


class ActivationApiClient:
    def __init__(self, env: Dict[str, str]):
        self.api_url = env.get("THINKWORK_API_URL", "").rstrip("/")
        self.secret = env.get("API_AUTH_SECRET", "")

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.api_url or not self.secret:
            return {"skipped": True, "reason": "activation api env missing"}
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{self.api_url}{path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.secret}",
                "Content-Type": "application/json",
            },
        )
        with request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}

    def notify(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/api/activation/notify", payload)

    def checkpoint(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/api/activation/checkpoint", payload)

    def complete(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/api/activation/complete", payload)
