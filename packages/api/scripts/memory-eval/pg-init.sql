-- Runs once on first boot of the local eval Postgres (docker-entrypoint-initdb.d).
-- pg_trgm must live in pg_catalog: Hindsight sets search_path to the candidate
-- schema only, so operators installed in `public` are invisible and retain
-- fails with `operator does not exist: text % text`.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER EXTENSION pg_trgm SET SCHEMA pg_catalog;
