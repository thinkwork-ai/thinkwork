# Validate result

Review the dashboard against the user's requested CRM scope, the discovered data, and the stated evidence boundaries. Confirm that key claims map back to sources or are clearly labeled as assumptions.

Check that the artifact includes the expected dashboard structure, avoids unsupported data claims, and gives the user obvious next actions.

Validate the artifact as a visual dashboard, not only as a data summary:

- It must not be a markdown report, prose-heavy summary, or stack of text-only cards.
- It must include a compact header/status row, KPI strip, at least one chart, and a useful table or ranked list.
- Stage exposure, stale activity, rep/account concentration, and opportunities must be rendered as visual comparisons when data exists.
- It must use `@thinkwork/computer-stdlib` primitives where practical and should not hand-roll plain text lists for core dashboard sections.
- It must not use emoji as icons, status markers, bullets, tab labels, headings, or data values. Icons must come from `lucide-react` or `@tabler/icons-react`, or be omitted.
- It must avoid duplicate host chrome such as an outer artifact frame, `App` badge, open-full control, or refresh controls supplied by the host.
- It must remain readable and non-overlapping in the embedded thread preview and in full-screen artifact view.

If the artifact fails these visual gates, mark validation as failed and explain the concrete issue instead of calling the result ready.
