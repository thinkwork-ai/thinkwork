# Admin screenshot capture checklist

Three marketing screenshots back the governance narrative on the homepage. Until the real PNGs land here, each showcase component renders a stylized SVG mockup (set `pending={true}` on `<ScreenshotFrame>`). To promote a real capture:

1. Drop the PNG at the path below.
2. Open the component and flip `pending` to `false` (or remove the attr).

Aspect target: roughly 16:10. Keep each file under ~400 KB. Strip any real tenant names or PII before committing.

## Required captures

### `agent-templates.png`
- Route: `/agent-templates/$templateId` in the admin app
- Show: the capability editor — tool allow-list, model pin, guardrail picker, skill assignments
- Component: `src/components/AgentTemplates.astro`

### `cost-analytics.png`
- Route: `/analytics` → Cost tab
- Show: per-agent spend time series with at least a week of data, plus the totals cards
- Component: `src/components/CostControl.astro`

### `evals-run.png`
- Route: `/evaluations/$runId`
- Show: pass-rate chart plus a visible per-test breakdown with a mix of pass and warn/fail states
- Component: `src/components/Evals.astro`

## Pre-commit pass

- No customer or teammate names visible
- No dev-mode banners, error toasts, or debug rails
- URL bar hidden (screenshot just the app pane, not the whole browser window)
- 2x DPI capture where possible for crispness at desktop widths
