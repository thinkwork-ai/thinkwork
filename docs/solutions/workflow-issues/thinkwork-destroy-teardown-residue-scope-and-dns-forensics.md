---
title: "thinkwork destroy teardown residue scope + post-teardown DNS forensics"
module: cli-deploy-teardown
date: 2026-07-02
category: workflow-issues
problem_type: workflow_issue
component: development_workflow
severity: medium
symptoms:
  - "Public resolvers return SERVFAIL for the stage domain after destroy; EDE text says parent NS \"returned REFUSED\" — stale Cloudflare delegation to a deleted Route53 zone"
  - "`dig +short` returns empty (ambiguous); only `dig +noall +comments` reveals status SERVFAIL plus the Extended DNS Error explanation"
  - "Per-account S3 state bucket (thinkwork-tfstate-<account-id>) and DynamoDB lock table survive destroy by design, including hundreds of release-artifacts/* seed objects and all object versions"
  - "AWS-auto-created ECS Container Insights log groups (/aws/ecs/containerinsights/thinkwork-<stage>-cluster/performance) remain after destroy"
  - "Stale multi-session context (compaction summary) claimed teardown was still pending when a parallel session had already run it"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
applies_when:
  - "Fully exiting an AWS account after `thinkwork destroy` (account exit, not per-stage teardown)"
  - "Custom-domain stages whose parent-zone NS delegation lives on an external DNS provider (Cloudflare) and was added manually outside terraform state"
  - "Diagnosing empty/failing DNS lookups after a zone teardown"
  - "Resuming teardown work from stale or compacted session context while parallel sessions may have acted"
related_components:
  - tooling
tags:
  - thinkwork-destroy
  - teardown-residue
  - route53-delegation
  - cloudflare-ns-records
  - dns-servfail-forensics
  - terraform-state-backend
  - s3-versioned-bucket-purge
  - multi-session-verification
---

# thinkwork destroy leaves parent-zone NS delegation, state backend, and Container Insights log groups behind

## Problem

After a full THINK-118 customer-flow test (stage `hci` deployed into fresh sandbox account 424337058806 with custom domain hci.thinkwork.ai), `thinkwork destroy` ran its clean-slate path successfully — but three classes of residue are structurally outside its reach, and one of them left hci.thinkwork.ai resolving to SERVFAIL for the whole internet:

1. **Stale parent-zone NS delegation.** Terraform created the Route53 hosted zone during deploy, but the NS delegation records at the parent zone (thinkwork.ai, hosted on Cloudflare) were added manually. Destroy deleted the child zone; the parent kept delegating to Route53 nameservers that no longer host it.
2. **Per-account Terraform state backend.** The CLI bootstraps `thinkwork-tfstate-<account-id>` (versioned S3) + `thinkwork-tflocks-<account-id>` (DynamoDB) once per account, outside terraform state, shared by all stages in that account. A per-stage destroy correctly must NOT remove them — but a full account exit has to, manually.
3. **ECS Container Insights log groups.** `/aws/ecs/containerinsights/thinkwork-<stage>-cluster/performance` is auto-created by the AWS ECS service when Container Insights is enabled. It is not in terraform state, so destroy leaves one per stage that ever ran a cluster.

## Symptoms

- `curl https://hci.thinkwork.ai` fails with exit 6 (could not resolve host).
- `dig +short hci.thinkwork.ai @1.1.1.1` returns **empty** — ambiguous on its own.
- The decisive diagnostic:

  ```bash
  dig hci.thinkwork.ai +noall +comments @1.1.1.1
  ```

  shows `status: SERVFAIL` with an EDNS Extended DNS Error (OPT=15) explaining exactly where it broke: `"at delegation hci.thinkwork.ai"` and `"[2600:9000:...]:53 returned REFUSED for hci.thinkwork.ai A"` — the parent still delegates to AWS nameservers that answer REFUSED because the zone is gone.
- `thinkwork-tfstate-424337058806` / `thinkwork-tflocks-424337058806` still exist after every stage in the account is destroyed.
- `aws logs describe-log-groups --log-group-name-prefix /aws/ecs/containerinsights/` shows a group per stage that ever ran an ECS cluster.

**Know both DNS signatures.** Earlier in this same workstream the inverse trap fired: querying the authoritative parent returned the delegation NS records in the **AUTHORITY** section (not ANSWER), which was misread as "NS records deleted" when they were intact. Delegation NS records legitimately appear in AUTHORITY when queried at the parent; SERVFAIL + REFUSED-at-delegation from a recursive resolver is the *deleted zone behind intact delegation* signature.

## What Didn't Work

- **`dig +short`** — empty output looks like a tooling or network problem and carries no diagnostic information. Only `+noall +comments` (or a full dig) exposes the SERVFAIL status and the EDNS extended-error text that names the delegation as the failure point.
- **`terraform output` / `terraform state list` in the CLI's scaffold dir** — returned "No outputs found" and 0 resources, which reads like broken terraform setup. Two things explain it: state keys live under terraform **workspace** prefixes (`env:/<stage>/thinkwork/<stage>/terraform.tfstate`), so a bare `terraform state list` without selecting the workspace sees nothing; and the destroy had already run, so the state file legitimately contains an empty resources array with a high serial. Fetch the S3 state object directly before concluding state is missing:

  ```bash
  aws s3api list-objects-v2 --bucket thinkwork-tfstate-<account-id> --prefix 'env:/'
  aws s3 cp "s3://thinkwork-tfstate-<account-id>/env:/hci/thinkwork/hci/terraform.tfstate" - | jq '{serial, resources: (.resources|length)}'
  ```

  Empty `resources` + high `serial` = a destroy ran, not missing state.
- **Trusting stale session context.** A compaction summary said teardown was "pending" when a parallel session had already validated and destroyed everything an hour earlier — acting on the summary would have meant duplicate teardown work against a stack that no longer existed. The residue hunt only went right because the current session verified live infra state (empty state file, missing hosted zone) and read the parallel session's transcript before touching anything. With multiple agent sessions on one repo, treat summaries as stale until verified against live state.

## Solution

**1. Delete the stale NS delegation at the parent (Cloudflare).** Token fetched at runtime from SSM `/thinkwork/dev/cloudflare-namespace-token`; zone `da656993d43affe73f063b06eed28bd6`:

```bash
CF_TOKEN=$(aws ssm get-parameter --name /thinkwork/dev/cloudflare-namespace-token \
  --with-decryption --query Parameter.Value --output text)
ZONE=da656993d43affe73f063b06eed28bd6

# List the 4 NS records for the stage domain, then delete each by id
curl -s -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=NS&name=hci.thinkwork.ai" \
  | jq -r '.result[].id' \
  | while read -r id; do
      curl -s -X DELETE -H "Authorization: Bearer $CF_TOKEN" \
        "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$id" | jq -c '{id: .result.id, success}'
    done
```

The token is server-side/operator-side only — it is never shipped in the CLI. The long-term product answer is the namespace-claim control-plane API (THINK-117).

**2. Purge and delete the state backend (account exit only).** The bucket is versioned, so every object version AND delete marker must be removed before `delete-bucket`; it also holds `release-artifacts/<version>/lambdas/*.zip` (hundreds of objects per pinned release). Paginate and delete in batches of ≤1000:

```bash
BUCKET=thinkwork-tfstate-424337058806
while : ; do
  BATCH=$(aws s3api list-object-versions --bucket "$BUCKET" --max-items 1000 --output json \
    | jq '{Objects: ([.Versions[]?, .DeleteMarkers[]?] | map({Key, VersionId})), Quiet: true}')
  [ "$(echo "$BATCH" | jq '.Objects | length')" -eq 0 ] && break
  aws s3api delete-objects --bucket "$BUCKET" --delete "$BATCH" > /dev/null
done
aws s3api delete-bucket --bucket "$BUCKET"
aws dynamodb delete-table --table-name thinkwork-tflocks-424337058806
```

**3. Delete the auto-created Container Insights log groups:**

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/ecs/containerinsights/ \
  --query 'logGroups[].logGroupName' --output text \
  | tr '\t' '\n' | while read -r lg; do aws logs delete-log-group --log-group-name "$lg"; done
```

**4. Final orphan scan — the acceptance criterion for "account exit complete".** Zero hits across every service, filtered on "thinkwork":

```bash
aws s3api list-buckets --query "Buckets[?contains(Name,'thinkwork')].Name"
aws dynamodb list-tables --query "TableNames[?contains(@,'thinkwork')]"
aws lambda list-functions --query "Functions[?contains(FunctionName,'thinkwork')].FunctionName"
aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?contains(Name,'thinkwork')].Name"
aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'thinkwork')].Id"
aws rds describe-db-clusters --query "DBClusters[?contains(DBClusterIdentifier,'thinkwork')].DBClusterIdentifier"
aws logs describe-log-groups --query "logGroups[?contains(logGroupName,'thinkwork')].logGroupName"
aws secretsmanager list-secrets --query "SecretList[?contains(Name,'thinkwork')].Name"
aws ssm describe-parameters --query "Parameters[?contains(Name,'thinkwork')].Name"
aws route53 list-hosted-zones --query "HostedZones[?contains(Name,'thinkwork')].Name"
aws iam list-roles --query "Roles[?contains(RoleName,'thinkwork')].RoleName"
```

All eleven returned empty for account 424337058806.

## Why This Works

Each residue class exists because it sits outside terraform's — and therefore `thinkwork destroy`'s — ownership boundary:

- The **parent-zone NS records** live in a different provider (Cloudflare) and a different account of control; terraform only ever managed the child Route53 zone. Deleting the child while the parent still points at it produces the SERVFAIL/REFUSED signature, and the only correct fix is at the **parent** (delete or repoint the NS records), never at Route53.
- The **state backend** is bootstrapped before terraform runs and is deliberately shared by all stages in the account — per-stage destroy skipping it is correct behavior, not a bug. That correctness is exactly why account exit needs a manual purge, and S3 versioning is why a naive `delete-bucket` fails until every version and delete marker is gone.
- The **Container Insights log groups** are created by the AWS ECS *service*, not by any terraform resource, so they were never in state to begin with.

The orphan scan works as an acceptance criterion because every thinkwork resource embeds "thinkwork" in its name, so an empty per-service name filter across the resource-bearing services is a complete account-exit proof.

## Prevention

- **After any full-environment teardown that used custom-domain delegation, run the three-point residue sweep:** (a) parent-zone NS records for the stage domain, (b) state backend bucket + lock table if exiting the account entirely, (c) `/aws/ecs/containerinsights/*` log groups. One scan command per service filtered on "thinkwork" (Solution step 4) is sufficient.
- **DNS diagnosis rules:** `dig +short` empty is ambiguous — always use `dig <name> +noall +comments @1.1.1.1`. SERVFAIL + "REFUSED at delegation" in the extended error = deleted zone behind intact delegation → fix at the parent. NS records in the AUTHORITY section when querying the authoritative parent = delegation intact, not deleted.
- **State inspection rule:** state keys are workspace-prefixed (`env:/<stage>/thinkwork/<stage>/terraform.tfstate`); inspect the S3 object directly rather than trusting `terraform state list` in the scaffold dir. Empty resources + high serial means a destroy already ran.
- **Multi-session rule:** with parallel agent sessions on one repo, verify live infra state and read the other session's transcript before acting on any compaction summary claiming work is "pending".
- **Candidate CLI improvement (follow-up, not yet built):** a `thinkwork destroy --account-exit` mode — or at minimum a post-destroy checklist printed by the CLI — that names the residue destroy cannot itself remove: parent-zone delegation, shared state backend, auto-created log groups.

## Related Documentation

- [MCP custom-domain setup](../patterns/mcp-custom-domain-setup-2026-04-23.md) — the deploy-side Cloudflare DNS setup whose teardown section this learning supersedes (manual dashboard deletion → API deletion with the SSM-held token).
- [Customer control-plane frozen bootstrap incompatibility](../integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md) — deploy-side counterpart of the same customer-domain machinery.
- [GitHub-free customer deployments (AWS control-plane pattern)](../architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md) — the environment class where per-account state-backend residue matters on account exit.

## Related Issues

- THINK-118 — CLI-first zero-to-deployed reliability workstream (the fresh-deploy/destroy harness this test exercised).
- THINK-117 — namespace-claim control-plane API; the product-level replacement for manual Cloudflare NS delegation.
