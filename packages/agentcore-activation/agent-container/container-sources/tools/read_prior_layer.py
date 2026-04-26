from typing import Any, Dict


def read_prior_layer(operating_model: Dict[str, Any], layer: str) -> Dict[str, Any]:
    layers = operating_model.get("layers") if isinstance(operating_model, dict) else {}
    prior = layers.get(layer, {}) if isinstance(layers, dict) else {}
    return {"layer": layer, "prior": prior, "epistemic_state": "tentative"}
