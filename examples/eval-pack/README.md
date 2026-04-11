# Thinkwork Eval Pack — Example

This directory contains a reference eval pack demonstrating how to evaluate a
Thinkwork agent using built-in and custom scorers.

## Structure

```
eval-pack/
  eval.yaml            # Eval configuration: agent, dataset, scorers, concurrency
  dataset.jsonl        # Test cases (one JSON object per line)
  scorers/
    __init__.py
    relevance.py       # Example custom scorer
  test.mjs             # Validation script
  package.json
```

## Running an Eval

```bash
# Set your agent ID
export AGENT_ID=agt_abc123

# Run via the Thinkwork CLI
thinkwork eval run eval.yaml

# Or validate the pack structure first
node test.mjs
```

## Dataset Format

Each line in `dataset.jsonl` is a JSON object with the following fields:

| Field      | Required | Description                                           |
| ---------- | -------- | ----------------------------------------------------- |
| `id`       | Yes      | Unique test case identifier (e.g. `"general-001"`)   |
| `input`    | Yes      | The message to send to the agent                      |
| `expected` | No       | Expected output or keyword (used by `contains_answer`)|
| `tag`      | No       | Category label (e.g. `"general"`, `"safety"`, `"tools"`) |
| `metadata` | No       | Arbitrary key/value pairs for filtering and reporting |

### Adding Test Cases

Append a new JSON object to `dataset.jsonl`:

```json
{"id": "my-001", "input": "What is 2 + 2?", "expected": "4", "tag": "tools"}
```

## Scorers

### Built-in Scorers

| Name             | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `contains_answer`| Checks that the response contains the `expected` value       |
| `no_refusal`     | Fails if the response is a refusal on a non-safety test case |
| `latency_sla`    | Fails if `latency_ms` exceeds the configured `threshold_ms`  |

### Custom Scorers

Custom scorers are Python functions referenced by `module` and `function` in
`eval.yaml`. Each scorer receives a `test_case` dict and a `response` dict and
returns a float between `0.0` and `1.0`.

```python
def score_relevance(test_case: dict, response: dict) -> float:
    ...
    return 0.85  # 0.0 = irrelevant, 1.0 = perfectly relevant
```

Add your scorer module to the `scorers/` directory and register it in `eval.yaml`:

```yaml
scorers:
  - type: custom
    name: my_scorer
    module: scorers.my_scorer
    function: score_my_scorer
```

## Validation

```bash
node test.mjs
```

Checks that `eval.yaml` has required fields, that all `dataset.jsonl` lines are
valid JSON with `id` and `input`, and that every custom scorer module file exists.
