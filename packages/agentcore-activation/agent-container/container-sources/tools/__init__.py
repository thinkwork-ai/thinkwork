from .dismiss_recommendation import dismiss_recommendation
from .mark_layer_complete import mark_layer_complete
from .propose_bundle_entry import propose_bundle_entry
from .propose_layer_summary import propose_layer_summary
from .read_prior_layer import read_prior_layer

REGISTERED_TOOLS = {
    "dismiss_recommendation": dismiss_recommendation,
    "mark_layer_complete": mark_layer_complete,
    "propose_bundle_entry": propose_bundle_entry,
    "propose_layer_summary": propose_layer_summary,
    "read_prior_layer": read_prior_layer,
}
