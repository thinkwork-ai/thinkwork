# Security Policy

## Reporting a Vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, please email **security@thinkwork.ai** with:

1. A description of the vulnerability
2. Steps to reproduce (or a proof-of-concept)
3. The impact you believe the vulnerability has
4. Your name/handle for attribution (optional)

We will acknowledge receipt within 48 hours and aim to provide a substantive response within 5 business days.

## Disclosure policy

We follow coordinated disclosure. After a fix is available:

1. We will release a patched version.
2. We will publish a GitHub Security Advisory.
3. We will credit the reporter (unless they prefer anonymity).

We ask reporters to give us reasonable time to address the issue before public disclosure.

## Scope

This policy covers the `thinkwork-ai/thinkwork` repository and its published artifacts:

- `thinkwork-cli` (npm)
- `thinkwork-ai/thinkwork/aws` (Terraform Registry)
- `thinkwork-ai/homebrew-tap` (Homebrew)
- The Astro Starlight docs site at `docs.thinkwork.ai`

For issues specific to AWS services themselves (Cognito, AppSync, Bedrock, Lambda, etc.), please report those directly to AWS via their [vulnerability reporting process](https://aws.amazon.com/security/vulnerability-reporting/).

## Supported versions

During pre-release (v0.x), only the latest release receives security patches. Once v1.0.0 ships, we will publish a formal support matrix.
