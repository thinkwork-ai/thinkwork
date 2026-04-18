# Admin — Evaluations screenshots

Drop these PNGs here. Filenames match the image refs in
`docs/src/content/docs/applications/admin/evaluations.mdx` — keep them
exact or you'll need to update the doc too.

| Filename | What to capture |
|---|---|
| `dashboard.png` | `/evaluations` — full viewport with metric cards + Pass Rate Trend + Recent Runs visible. |
| `run-evaluation-dialog.png` | Dashboard → **Run Evaluation**. Capture the open dialog (template, model, invocation mode, categories visible). |
| `studio-list.png` | `/evaluations/studio` — test-case list, ideally after seeding the starter pack so the table has rows. |
| `test-case-detail.png` | Click a test-case name (e.g. `red-team-02`). Capture the Test Configuration card + Run History. |
| `test-case-editor.png` | From the detail page → **Edit**. Show the assertion repeater and the AgentCore evaluator pills (scroll if needed). |
| `run-results.png` | Click a completed run row. Capture the header (status / pass rate / cost), the category filter chips, and the Results table. |
| `result-detail-sheet.png` | From Run Results → click any row. Capture the opened side Sheet with Input / Expected / Actual Output / Assertions visible. |

## Size / format

- **Format:** PNG
- **Width:** any; ~1200–1600px is ideal for retina-looking screenshots without blowing up the docs bundle
- **Height:** whatever matches the captured region; doc CSS scales them responsively
- **DPR:** 2x/retina is fine, docs image optimization handles it

CleanShot "Capture Window" on the Brave window works well — gets just the page content without the desktop chrome.
