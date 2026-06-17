# Refactor Managed-App State Isolation

## Problem

The June 17 Plane/CRM incident showed that managed-app lifecycle operations and ordinary platform deploys still share one Terraform state and one broad variable envelope. A release deploy that was unrelated to Plane received incomplete Plane desired-state inputs, so Terraform interpreted absent values as disabled state and rewrote root outputs to `plane_provisioned=false`. The app resources were later restored, but the shared-state coupling made a normal release capable of disrupting durable app hostnames.

Stable customer-facing CNAMEs such as `crm.thinkwork.ai` and `plane.thinkwork.ai` must not depend on every release deploy carrying every managed app's desired-state payload perfectly.

## Target Shape

Split Terraform ownership into independently locked state scopes:

- **Platform state** owns core Thinkwork infrastructure, shared data plane, Cognito, lambdas, AgentCore, and global outputs.
- **DNS state** owns stable public names and certificate validation records, or a small DNS adapter that consumes app ALB outputs without owning app lifecycle.
- **Managed app state** is keyed by stage and app, for example `thinkwork/<stage>/managed-apps/<appKey>/terraform.tfstate`. Twenty and Plane app resources, databases, queues, caches, runtime services, and app-specific outputs live here.

The controller becomes the only writer for managed app state. Release deploys may read managed app outputs, but they must not be able to disable, destroy, or stale-write app runtime state.

## Migration Plan

1. Define the state contract.
   - List the exact outputs platform and DNS consumers need from each app: URL, ALB DNS name, service names, runtime status, and health probe paths.
   - Persist desired state as an explicit controller record, not as optional root Terraform defaults.
   - Treat missing desired-state fields as invalid for app writes, never as false.

2. Introduce per-app backend key derivation in the deployment controller.
   - For managed app operations, run Terraform with a backend key derived from `{stage, appKey}`.
   - Keep platform deploys on the existing root backend key.
   - Add tests proving a Plane operation and a platform deploy use different backend keys and lock scopes.

3. Move state safely.
   - Freeze managed app writes during the migration window.
   - Use `terraform state mv` or import blocks to move Twenty and Plane resources from root state into their app states.
   - Verify app state plans are no-op before thawing the controller.

4. Split DNS ownership deliberately.
   - Preferred: keep durable CNAMEs in DNS state and feed them app ALB DNS names from app outputs.
   - Alternative: app state owns only its app CNAME, but DNS deletion must be protected with `prevent_destroy`.
   - Either way, Cloudflare records for stable names must never be destroyed by a missing app variable in a platform deploy.

5. Harden deploy gates.
   - Platform deploy should fail fast if it receives managed-app mutation variables.
   - Managed app deploy should fail fast if required desired-state fields are absent.
   - Add an integration smoke that verifies `crm.thinkwork.ai` and `plane.thinkwork.ai` resolve and return an expected status after any deploy touching Terraform.

## Immediate Bridge

Before the full split lands, the controller should refresh root outputs after a successful targeted managed-app apply. That keeps root outputs aligned with the live app resources and prevents UI/API status from reading stale values such as `plane_provisioned=false`.
