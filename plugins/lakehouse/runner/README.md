# LakeHouse Edge Runner

The LakeHouse edge runner is the customer-side execution substrate for approved
Meltano bundles. The runner pulls a signed immutable bundle, verifies the digest
and file hashes, materializes a clean project directory for each run, injects
local secrets from customer-approved references, and reports structured evidence
without source row payloads.

This package slice is deliberately local and deterministic. It does not deploy
infrastructure, open inbound Oracle access, or make local edits canonical. Any
durable configuration change must return through the ThinkWork review and
approved bundle publication path.
