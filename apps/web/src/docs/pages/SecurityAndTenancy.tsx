/**
 * Security & tenancy (Operations) — THINK-701.
 *
 * The claim this page has to earn is that the tenant boundary is the
 * *deployment*, not a WHERE clause. Everything else here (sign-in routes,
 * roles, the audit log) hangs off that.
 *
 * Converted to the report restyle (2026-08-11 docs overhaul). Claims
 * re-verified against: apps/web/src/components/settings/settings-nav.tsx
 * (operatorOnly sections) + SettingsUsers.tsx / SettingsUserDetail.tsx
 * (roles member/admin/owner; owner-gated promotion), apps/web +
 * apps/mobile lib/auth-options.ts (/api/auth/options publishes routes per
 * deployment; google/microsoft/entra federation), packages/api
 * workspace-manifest.ts + artifacts/payload-storage.ts (tenants/<slug>/
 * key prefix, keys outside it refused), packages/api tenant-scoping tests
 * (messages-tenant-scoping, admin-authz), and packages/database-pg/
 * graphql/types/compliance.graphql (event types; append-only via the
 * audit_events_block_delete trigger).
 *
 * Deliberately NOT here: an AWS architecture deep-dive, and the compliance
 * runbook set (kept as separate operator documentation, per THINK-701).
 * One amber element on purpose — the connector-egress Invariant; the
 * tenant isolation machinery itself is platform automation and stays teal.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  InfoCard,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import { TenancyDiagram } from "../figures/operations";
import type { DocTocEntry } from "../registry";

export const SECURITY_AND_TENANCY_TOC: DocTocEntry[] = [
  { id: "tenancy", title: "Tenancy" },
  { id: "identity", title: "Identity and sign-in" },
  { id: "roles", title: "Roles and what they unlock" },
  { id: "data-boundaries", title: "Data boundaries" },
  { id: "audit-trail", title: "The audit trail" },
  { id: "secrets", title: "Secrets, and where compliance lives" },
];

export function SecurityAndTenancy() {
  return (
    <ReportArticle
      eyebrow="Operations"
      title="Security & tenancy"
      lead="Everything in the product hangs off one boundary — the tenant. This page says where that line is drawn, who is allowed across it, and what never crosses it."
    >
      <ReportSection id="tenancy" title="Tenancy">
        <p>
          A <Term>tenant</Term> is one organization&apos;s ThinkWork Agent: its
          people, its agents, its threads, its files. The important thing about
          it is <strong>where the boundary is physically drawn</strong>.
        </p>
        <PullQuote who="the tenancy model, in one sentence">
          A tenant is not a filter applied inside a shared cluster — it is a
          separately deployed stack, in an AWS account you control, with its
          own database, its own object storage, its own agent runtime and its
          own sign-in pool.
        </PullQuote>
        <TenancyDiagram />
        <p>
          Each deployment is addressed by a <strong>stage</strong> name —{" "}
          <code>dev</code>, <code>prod</code>, a customer slug. One stage, one
          tenant, one set of URLs. That is why{" "}
          <DocLink slug="cli-and-deployment">deploying a second stage</DocLink>{" "}
          is the way to get a second environment: there is no environment
          switch inside a running stack.
        </p>
        <CardGrid>
          <InfoCard title="What this buys">
            <p>
              The strongest isolation question — &ldquo;could another
              customer&apos;s data reach us through a bug in a query?&rdquo; —
              has an infrastructural answer rather than a code one.
            </p>
          </InfoCard>
          <InfoCard title="What it costs">
            <p>
              Anything you want in two environments has to be deployed twice,
              and configuration does not follow you between them.
            </p>
          </InfoCard>
        </CardGrid>
      </ReportSection>

      <ReportSection id="identity" title="Identity and sign-in">
        <p>
          All three clients — web, mobile and the CLI — authenticate through{" "}
          <strong>Amazon Cognito</strong> in your stack. None of them holds a
          password of its own, and none of them talks to the API without a
          token Cognito issued.
        </p>
        <p>
          Which sign-in routes a deployment offers is not hardcoded into the
          apps. Each client asks the deployment what it supports and renders
          exactly that, so a stack configured for Google-only never shows a
          password field:
        </p>
        <Flow>
          <FlowBox
            title="The client asks"
            sub="web, mobile and CLI all ask the same question"
          />
          <FlowArrow label="published sign-in routes" />
          <FlowBox
            title="Cognito route"
            sub="Google, Microsoft / Entra, or email + password"
          />
          <FlowArrow label="tokens" />
          <FlowBox
            title="A session in one tenant"
            sub="every call after this carries the identity"
          />
        </Flow>
        <p>
          Google and Microsoft sign-in are <strong>federated</strong>: the
          identity provider authenticates the person, and Cognito issues the
          session. Your organization&apos;s existing account policy — MFA,
          conditional access, device rules — keeps applying, because the
          actual authentication still happens at your provider.
        </p>
        <p>
          Sessions are refreshed rather than re-entered. On the{" "}
          <DocLink slug="mobile-app">mobile app</DocLink> that refresh token
          also sits behind Face ID when you turn biometric lock on; in the CLI
          it lives in a per-stage session file on your machine.
        </p>
        <p>
          One thing federation does not do: signing in with a Google or
          Microsoft account proves who you are, not that you belong here. A
          person still needs to exist as a member of the tenant — invited by
          an operator from <strong>Settings → Users</strong> — before they can
          do anything. A successful sign-in that lands on an empty app almost
          always means the sign-in worked and the membership is missing.
        </p>
      </ReportSection>

      <ReportSection id="roles" title="Roles and what they unlock">
        <p>
          Every member carries one of three roles, set on their user page under{" "}
          <strong>Settings → Users</strong>:
        </p>
        <DocTable
          head={["Role", "What it can do"]}
          rows={[
            [
              <strong>member</strong>,
              "Do the work: spaces they belong to, their own threads, their own connector accounts, their own profile and activity. Sees General, Connectors and Activity in settings — nothing else.",
            ],
            [
              <strong>admin</strong>,
              <>
                Everything a member can do, plus the operator surfaces: users,
                spaces, agents, skills, tools, the{" "}
                <DocLink slug="model-catalog">model catalog</DocLink>,{" "}
                <DocLink slug="evaluations">evaluations</DocLink>,{" "}
                <DocLink slug="automations">workflows</DocLink> and memory.
              </>,
            ],
            [
              <strong>owner</strong>,
              "The same operator surfaces, and the last word on membership — owner is the role that can promote and demote other operators.",
            ],
          ]}
        />
        <p>
          &ldquo;Operator&rdquo; throughout these docs means{" "}
          <strong>admin or owner</strong>. Operator-only sections are hidden
          from the settings navigation for members rather than shown and
          refused, so a member&apos;s settings screen is genuinely short.
        </p>
        <p>
          Roles are not the only fence. Role decides which screens you get.
          What an <em>agent</em> may do on your behalf is a separate and
          narrower question, answered by{" "}
          <DocLink slug="approvals-and-guardrails">
            approvals and guardrails
          </DocLink>{" "}
          and by the per-user credentials in{" "}
          <DocLink slug="connectors-and-mcp">connectors</DocLink>. An admin
          with no Google account connected still gets no calendar access.
        </p>
      </ReportSection>

      <ReportSection id="data-boundaries" title="Data boundaries">
        <p>
          Inside the stack, three stores hold everything, and all three are
          stamped:
        </p>
        <DocTable
          head={["Store", "What lives there", "How it is scoped"]}
          rows={[
            [
              <strong>Aurora Postgres</strong>,
              "threads, messages, agents, spaces, configuration",
              "every row carries its tenant, and the resolvers scope to the caller's tenant rather than trusting an id from the request",
            ],
            [
              <strong>S3</strong>,
              <>
                <Term>agent folder</Term> files, installed skills, attachments
                and artifacts
              </>,
              <>
                a per-tenant key prefix (<code>tenants/&lt;tenant&gt;/…</code>);
                a key outside your tenant&apos;s prefix is refused, not merely
                absent from the listing
              </>,
            ],
            [
              <strong>Agent memory</strong>,
              <>
                managed <DocLink slug="memory">memory</DocLink>
              </>,
              "namespaced per agent inside the stack, so one agent's recollections are not another agent's context, let alone another tenant's",
            ],
          ]}
        />
        <p>
          Two smaller boundaries are worth knowing because they surprise
          people. Connector credentials are <strong>per user</strong>, not per
          tenant — your Google token is yours, and an agent acting for a
          colleague uses theirs. And <DocLink slug="spaces">spaces</DocLink>{" "}
          narrow visibility <em>within</em> a tenant: being a member does not
          mean seeing every thread.
        </p>
        <Invariant title="Nothing an agent can reach is inside the boundary by default">
          <p>
            The isolation described here covers what ThinkWork Agent stores.
            The moment an agent calls out through a connector or an MCP
            server, the data lands wherever that system keeps it. That is the
            intended behavior — it is also the reason the interesting review
            is of <DocLink slug="connectors-and-mcp">what is connected</DocLink>,
            not of the database.
          </p>
        </Invariant>
      </ReportSection>

      <ReportSection id="audit-trail" title="The audit trail">
        <p>
          Security-relevant events are recorded to an append-only audit log:
          sign-ins and sign-in failures, invitations and user creation, agents
          created and deleted, skills and MCP servers granted and detached,
          guardrail decisions, approvals, artifact shares created and revoked.
          Deletes are blocked at the database layer rather than by convention,
          and reads are scoped to your own tenant.
        </p>
        <p>
          For day-to-day &ldquo;what did the agent actually do?&rdquo;
          questions the faster surface is <strong>Settings → Activity</strong>,
          which shows threads and turns with their tool calls. The audit log
          answers the different question of who changed the configuration, and
          when.
        </p>
      </ReportSection>

      <ReportSection id="secrets" title="Secrets, and where compliance lives">
        <p>
          Credentials the platform holds — connector tokens, API secrets,
          database credentials — are stored in AWS Secrets Manager and SSM
          Parameter Store inside your own account, and are read by the runtime
          at invocation time rather than baked into any image or config file.
        </p>
        <p>
          Nothing in the product asks you to paste a secret into a page that
          then displays it back: connector credentials are established through
          an OAuth redirect, and the app shows you a status, not a token.
        </p>
        <p>
          Compliance documentation is maintained separately. Control
          descriptions, the compliance module reference and the associated
          runbooks live outside these product docs and are available from your
          operator on request.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
