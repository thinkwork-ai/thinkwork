# Fix Computer Sandbox Production Deploy

## Goal

Ship the Computer iframe sandbox to production without falling back to same-origin code artifact rendering.

## Problem

The first production deploy failed because the sandbox DNS record count depended on a CloudFront output that is unknown before apply. The follow-up deploy fixed that count issue, but failed after Terraform tried to add `sandbox.thinkwork.ai` to the shared `thinkwork.ai` ACM certificate. That replacement path attempted to rewrite existing Cloudflare validation records for production domains such as `computer.thinkwork.ai`, `admin.thinkwork.ai`, and `api.thinkwork.ai`.

## Plan

1. Keep `sandbox.thinkwork.ai` out of the shared apex/www/docs/admin/computer/API ACM certificate.
2. Create a dedicated ACM certificate and DNS validation record for `sandbox.thinkwork.ai`.
3. Continue to let `www-dns` manage the sandbox Cloudflare CNAME to the sandbox CloudFront distribution.
4. Keep code artifact rendering sandbox-only; do not restore the legacy same-origin loader.
5. Validate with Terraform, the sandbox fixture test, CI, and the main deploy.

## Status

- Branch: `codex/fix-sandbox-cert`
- PR: pending
- Deploy: pending
