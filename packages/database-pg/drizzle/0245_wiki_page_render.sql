-- THINK-273 (THINK-270 U2): persisted wiki page plate renders.
-- Nullable render columns on wiki.pages: the compositor-produced
-- self-contained HTML plate render, the plate slug it was compiled with,
-- and the render timestamp. Best-effort — all three are set together or
-- all NULL (compile failure, oversize output, or a page that predates
-- render persistence). Additive — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0245_wiki_page_render.sql
-- creates-column: wiki.pages.render_html
-- creates-column: wiki.pages.render_plate_slug
-- creates-column: wiki.pages.rendered_at

BEGIN;

ALTER TABLE wiki.pages
  ADD COLUMN IF NOT EXISTS render_html text,
  ADD COLUMN IF NOT EXISTS render_plate_slug text,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz;

COMMIT;
