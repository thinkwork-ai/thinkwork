# Computer Layout Notes

- Workbench routes keep the global sidebar visible so users can move between Computer, new threads, apps, approvals, memory, and thread history without losing context.
- Generated app routes use a single applet canvas. Editing, provenance, and transcript affordances should move to a separate surface such as a sheet rather than sharing the default app view.
- The transcript panel should prefer a stable width; the app canvas should own remaining space and become the first-class surface on wide screens.
- Mobile and narrow tablet layouts collapse the split shell into a canvas-first stack with transcript/provenance available as a secondary panel.
- Composition decisions stay inside `apps/computer`; shared primitives remain in `@thinkwork/ui`.
