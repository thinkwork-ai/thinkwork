/**
 * Materializes the capability-sdk (proof-of-possession broker client) into a
 * capability-private Code Interpreter session (THINK-280).
 *
 * The trusted host (routine-exec-git) is responsible for delivering the SDK
 * the sandbox imports — the SDK's own docstring says so ("Materialized as a
 * package by the trusted host"). The three source files are bundled into this
 * Lambda as text (esbuild `--loader:.py=text`) and written to a session-local
 * directory on `sys.path` before the routine module runs, so the module can
 * `from client import CapabilityBrokerClient, SessionBootstrap` and drive the
 * broker with the injected `_twcap_session` bootstrap.
 *
 * The files are flat (`canonical.py`, `ed25519.py`, `client.py`) to satisfy the
 * SDK's flat-import fallback (`import canonical, ed25519`). Source is base64'd
 * to avoid any Python/JS string-escaping hazard.
 */
import canonicalPy from "../../../agentcore-pi/agent-container/src/runtime/capability-sdk/canonical.py";
import ed25519Py from "../../../agentcore-pi/agent-container/src/runtime/capability-sdk/ed25519.py";
import clientPy from "../../../agentcore-pi/agent-container/src/runtime/capability-sdk/client.py";

/** Session-local directory the SDK is written to (added to sys.path). */
export const SANDBOX_SDK_DIR = "/tmp/_twcap_sdk";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

/**
 * A Python preamble that writes the SDK files and puts them on sys.path. Emit
 * this ONLY for capability-headless runs (a session bootstrap is present) — a
 * regular sandbox run neither needs nor should see the broker client.
 */
export function buildSdkMaterializationPreamble(): string {
  const files: Array<[string, string]> = [
    ["canonical.py", b64(canonicalPy)],
    ["ed25519.py", b64(ed25519Py)],
    ["client.py", b64(clientPy)],
  ];
  const entries = files
    .map(([name, data]) => `    (${JSON.stringify(name)}, ${JSON.stringify(data)}),`)
    .join("\n");
  return [
    "import base64 as _twcap_b64, os as _twcap_os, sys as _twcap_sys",
    `_twcap_sdk_dir = ${JSON.stringify(SANDBOX_SDK_DIR)}`,
    "_twcap_os.makedirs(_twcap_sdk_dir, exist_ok=True)",
    "for _twcap_name, _twcap_data in (",
    entries,
    "):",
    "    with open(_twcap_os.path.join(_twcap_sdk_dir, _twcap_name), 'wb') as _twcap_f:",
    "        _twcap_f.write(_twcap_b64.b64decode(_twcap_data))",
    "if _twcap_sdk_dir not in _twcap_sys.path:",
    "    _twcap_sys.path.insert(0, _twcap_sdk_dir)",
    "",
  ].join("\n");
}
