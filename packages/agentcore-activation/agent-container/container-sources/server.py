import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

from interview_runtime import handle_invocation
from tools import REGISTERED_TOOLS

EXPECTED_TOOLS = {
    "propose_layer_summary",
    "mark_layer_complete",
    "propose_bundle_entry",
    "read_prior_layer",
    "dismiss_recommendation",
}


missing_tools = EXPECTED_TOOLS.difference(REGISTERED_TOOLS)
if missing_tools:
    raise RuntimeError(f"Activation runtime missing tools: {sorted(missing_tools)}")


class ActivationHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/ping":
            self._json({"ok": True, "tools": sorted(REGISTERED_TOOLS)})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/invocations":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw)
            result = handle_invocation(payload)
            self._json(result)
        except Exception as exc:
            self._json({"error": str(exc)}, status=500)

    def _json(self, body: Dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    HTTPServer(("", port), ActivationHandler).serve_forever()


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    body = event.get("body")
    payload = json.loads(body) if isinstance(body, str) else event
    result = handle_invocation(payload)
    return {"statusCode": 200, "body": json.dumps(result)}


if __name__ == "__main__":
    main()
