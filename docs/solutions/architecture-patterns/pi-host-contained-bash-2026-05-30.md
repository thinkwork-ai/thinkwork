# Pi Host-Contained Bash

Date: 2026-05-30

ThinkWork Pi hosts should expose `bash` as a powerful local workspace tool, not
as unbounded native OS access. Mobile already uses `just-bash` inside Hermes.
Desktop Local Pi now follows the same philosophy by providing a host-owned
`just-bash` custom tool named `bash` and removing the upstream SDK native bash
from the desktop built-in allowlist.

## Contract

- The model still sees a familiar `bash` tool.
- The tool runs in `/workspace`, preloaded from the rendered ThinkWork workspace.
- Public internet is enabled for useful commands such as `curl`.
- Private and loopback network ranges are denied.
- The tool cannot read arbitrary device or desktop host files.
- The system prompt must describe this honestly as a contained host workspace
  sandbox.

## Host Notes

Mobile keeps its existing `localBashExtension`, backed by `just-bash`, per-thread
snapshots, and workspace-cache hydration.
On React Native/Hermes, import `just-bash/browser`; the package root can pull in
Node-oriented bundle code that Hermes cannot parse.

Desktop Local Pi now registers `apps/desktop/src/sidecar/just-bash-tool.ts` as a
custom `bash` tool and allowlists the remaining upstream Pi built-ins:
`read`, `edit`, `write`, `grep`, `find`, and `ls`. This preserves Pi's small
tool surface while preventing accidental native macOS shell exposure.

AgentCore Pi can continue using upstream Pi built-ins inside the AWS runtime
container. That host already has a cloud sandbox boundary; if its bash policy
needs to converge further, do it as a separate runtime-container unit.
