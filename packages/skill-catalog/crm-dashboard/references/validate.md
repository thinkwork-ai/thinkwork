# Validate result

Superseded by the fast CRM dashboard flow. New runs should not create a separate validation phase. `save_app` compile/policy validation is the validation checkpoint; if it fails once, report the concrete error and stop.
