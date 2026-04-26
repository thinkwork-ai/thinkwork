from typing import Any, Dict

from activation_api_client import ActivationApiClient
from env_snapshot import snapshot_at_entry
from prompts.layer_prompts import LAYER_PROMPTS


def _interview_inert(payload: Dict[str, Any], env: Dict[str, str]) -> Dict[str, Any]:
    layer = payload.get("currentLayer") or payload.get("layerId") or "rhythms"
    mode = payload.get("mode", "full")
    if payload.get("action") == "start" and mode == "refresh":
        message = f"Let's refresh {layer}. I will treat prior notes as tentative until you confirm them."
    else:
        message = f"{LAYER_PROMPTS.get(layer, 'Tell me what matters here')} What should I know first?"
    if payload.get("sessionId"):
        ActivationApiClient(env).notify(
            {
                "sessionId": payload["sessionId"],
                "tenantId": payload.get("tenantId"),
                "userId": payload.get("userId"),
                "currentLayer": layer,
                "status": "in_progress",
                "lastAgentMessage": message,
                "eventType": "agent_message",
            }
        )
    return {"message": message, "currentLayer": layer, "status": "in_progress"}


interview_fn = _interview_inert


def handle_invocation(payload: Dict[str, Any]) -> Dict[str, Any]:
    env = snapshot_at_entry()
    return interview_fn(payload, env)
