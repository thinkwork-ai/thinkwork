# www-dns

DNS + TLS wiring for the public website, using a Cloudflare-managed zone and an AWS ACM certificate.

## What it creates

1. ACM certificate in `us-east-1` covering the apex and `www` SAN, DNS-validated via Cloudflare records.
2. Apex CNAME in Cloudflare pointing at the primary www CloudFront distribution (DNS-only, grey-cloud).
3. S3 website-redirect bucket + a second CloudFront distribution that 301s `www.<domain>` → `https://<domain>`, plus its Cloudflare CNAME.

## Why a second CloudFront distribution instead of a Cloudflare page rule

The apex and www records must be **DNS-only** so CloudFront can terminate TLS with the ACM cert. DNS-only traffic bypasses Cloudflare's proxy, so Cloudflare page rules and transform rules never run. The redirect has to live at AWS. An S3 website bucket with `redirect_all_requests_to` is the cheapest, simplest thing that works.

## Required environment

- `CLOUDFLARE_API_TOKEN` — exported in the shell or CI environment. **Never** committed to tfvars. Rotate after anyone outside the deploy path sees it.

## Usage (from greenfield example)

```hcl
provider "cloudflare" {
  # token read from CLOUDFLARE_API_TOKEN env var
}

module "www_dns" {
  source                 = "../../modules/app/www-dns"
  stage                  = var.stage
  domain                 = var.www_domain
  cloudflare_zone_id     = var.cloudflare_zone_id
  cloudfront_domain_name = module.thinkwork.www_distribution_domain
}
```

Then pass `module.www_dns.certificate_arn` back into `module "thinkwork"` as `www_certificate_arn`.

## First-apply ordering

On a fresh apply, Terraform has to create the primary CloudFront distribution (via `module.thinkwork.www_site`) before this module can reference its domain name. Terraform's dependency graph handles that automatically. If you're applying after a `terraform destroy`, two `apply` passes are fine — the first resolves the cert + distributions, the second binds the apex CNAME once the CloudFront distribution has deployed.
