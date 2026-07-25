-- KB page transcription U1: image-bearing source documents are transcribed
-- page-by-page before ingestion, so the manifest has to record what the
-- preprocessor produced.
--
-- Background: Bedrock's default parser "only parses text in text files" and
-- the platform never sends a parsingConfiguration, so scanned pages and
-- embedded screenshots index as nothing. 71 of McPherson's 80 CX SOP PDFs
-- (89%) keep most of their substance inside images. The fix is a preprocessor
-- that splits each PDF page and transcribes it with a Claude vision model,
-- then ingests one IN_LINE document per page under id '<key>#p=<n>'.
--
-- Contents:
--   * knowledge_base_sources.parsing_strategy CHECK widened from the implicit
--     'DEFAULT' to ('DEFAULT','TRANSCRIBE'). The column already exists and
--     defaults to 'DEFAULT'; it was previously wired to nothing.
--   * knowledge_base_documents gains the preprocessor result: derived_prefix
--     (workspace-bucket location of pages/<n>.md + report.json), page_count,
--     preprocessor_version (joins the change-detection predicate so a
--     pipeline bump forces reprocessing), page_report (per-page route, model
--     used, flags) and needs_review (any page the preprocessor flagged as
--     low-signal — indexed with a warning, never silently dropped).
--
-- Manifest identity is unchanged: ONE row per source document. Page documents
-- are an ingestion-level fan-out; their Bedrock statuses fold back up to the
-- base document_key.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0278_kb_page_transcription.sql
-- creates-column: public.knowledge_base_documents.derived_prefix
-- creates-column: public.knowledge_base_documents.page_count
-- creates-column: public.knowledge_base_documents.preprocessor_version
-- creates-column: public.knowledge_base_documents.page_report
-- creates-column: public.knowledge_base_documents.needs_review
-- creates: public.idx_kb_documents_needs_review
-- creates-constraint: public.knowledge_base_sources.knowledge_base_sources_parsing_strategy_check

ALTER TABLE public.knowledge_base_documents
  ADD COLUMN IF NOT EXISTS derived_prefix text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS preprocessor_version text,
  ADD COLUMN IF NOT EXISTS page_report jsonb,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- Operator surface: "which documents came back with pages the preprocessor
-- was unsure about". Partial — the overwhelming majority are false.
CREATE INDEX IF NOT EXISTS idx_kb_documents_needs_review
  ON public.knowledge_base_documents (knowledge_base_id)
  WHERE needs_review;

ALTER TABLE public.knowledge_base_sources
  DROP CONSTRAINT IF EXISTS knowledge_base_sources_parsing_strategy_check;

ALTER TABLE public.knowledge_base_sources
  ADD CONSTRAINT knowledge_base_sources_parsing_strategy_check
  CHECK (parsing_strategy IN ('DEFAULT', 'TRANSCRIBE'));
