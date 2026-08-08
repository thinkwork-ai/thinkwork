/**
 * Security & tenancy (Operations) — THINK-701.
 *
 * The claim this page has to earn is that the tenant boundary is the
 * *deployment*, not a WHERE clause. Everything else here (sign-in routes,
 * roles, the audit log) hangs off that.
 *
 * Verified against: apps/web settings nav + SettingsUsers/SettingsUserDetail
 * (roles member/admin/owner, operatorOnly sections), apps/web + apps/mobile
 * lib/auth-options.ts (/api/auth/options publishes the routes per
 * deployment), packages/api tenants/<slug>/... S3 key tests, and
 * packages/database-pg/graphql/types/compliance.graphql.
 *
 * Deliberately NOT here: an AWS architecture deep-dive, and the compliance
 * runbook set (kept as separate operator documentation, per THINK-701).
 */
import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowChip,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
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
    <DocArticle
      eyebrow="Operations"
      title="Security & tenancy"
      lead="Everything in the product hangs off one boundary — the tenant. This page says where that line is drawn, who is allowed across it, and what never crosses it."
    >
      <Section id="tenancy" title="Tenancy">
        <p>
          A <Term>tenant</Term> is one organization&apos;s ThinkWork Agent: its
          people, its agents, its threads, its files. The important thing about
          it is <strong>where the boundary is physically drawn</strong>. A
          tenant is not a filter applied inside a shared cluster — it is a
          separately deployed stack, in an AWS account you control, with its own
          database, its own object storage, its own agent runtime and its own
          sign-in pool.
        </p>
        <TenancyDiagram />
        <p>
          Each deployment is addressed by a <strong>stage</strong> name —{" "}
          <code>dev</code>, <code>prod</code>, a customer slug. One stage, one
          tenant, one set of URLs. That is why{" "}
          <DocLink slug="cli-and-deployment">deploying a second stage</DocLink>{" "}
          is the way to get a second environment: there is no environment switch
          inside a running stack.
        </p>
        <Callout tone="note" title="What this buys, and what it costs">
          <p>
            The upside is that the strongest isolation question — &ldquo;could
            another customer&apos;s data reach us through a bug in a
            query?&rdquo; — has an infrastructural answer rather than a code
            one. The cost is that anything you want in two environments has to
            be deployed twice, and configuration does not follow you between
            them.
          </p>
        </Callout>
      </Section>

      <Section id="identity" title="Identity and sign-in">
        <p>
          All three clients — web, mobile and the CLI — authenticate through{" "}
          <strong>Amazon Cognito</strong> in your stack. None of them holds a
          password of its own, and none of them talks to the API without a token
          Cognito issued.
        </p>
        <p>
          Which sign-in routes a deployment offers is not hardcoded into the
          apps. Each client asks the deployment what it supports and renders
          exactly that, so a stack configured for Google-only never shows a
          password field:
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Fingerprint}
              title="The client asks the deployment"
              sub="web, mobile and CLI all ask the same question"
              tone="consumer"
            >
              <FlowChip>which routes?</FlowChip>
            </FlowNode>
            <FlowLink label="published sign-in routes" />
            <FlowNode
              icon={KeyRound}
              title="Cognito route"
              sub="Google, Microsoft / Entra, or email + password"
              tone="source"
            >
              <FlowChip>federated</FlowChip>
              <FlowChip>password</FlowChip>
            </FlowNode>
            <FlowLink label="tokens" />
            <FlowNode
              icon={ShieldCheck}
              title="A session in one tenant"
              sub="every call after this carries the identity"
              tone="compute"
            />
          </FlowChain>
        </FlowDiagram>
        <p>
          Google and Microsoft sign-in are <strong>federated</strong>: the
          identity provider authenticates the person, and Cognito issues the
          session. Your organization&apos;s existing account policy — MFA,
          conditional access, device rules — keeps applying, because the actual
          authentication still happens at your provider.
        </p>
        <p>
          Sessions are refreshed rather than re-entered. On the{" "}
          <DocLink slug="mobile-app">mobile app</DocLink> that refresh token
          also sits behind Face ID when you turn biometric lock on; in the CLI
          it lives in a per-stage session file on your machine.
        </p>
        <Callout tone="warn" title="Federated users are not automatic members">
          <p>
            Signing in with a Google or Microsoft account proves who you are,
            not that you belong here. A person still needs to exist as a member
            of the tenant — invited by an operator from{" "}
            <strong>Settings → Users</strong> — before they can do anything. A
            successful sign-in that lands on an empty app almost always means
            the sign-in worked and the membership is missing.
          </p>
        </Callout>
      </Section>

      <Section id="roles" title="Roles and what they unlock">
        <p>
          Every member carries one of three roles, set on their user page under{" "}
          <strong>Settings → Users</strong>:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">What it can do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">member</td>
                <td className="text-foreground/80">
                  Do the work: spaces they belong to, their own threads, their
                  own connector accounts, their own profile and activity. Sees
                  General, Connectors and Activity in settings — nothing else.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">admin</td>
                <td className="text-foreground/80">
                  Everything a member can do, plus the operator surfaces: users,
                  spaces, agents, skills, tools, the{" "}
                  <DocLink slug="model-catalog">model catalog</DocLink>,{" "}
                  <DocLink slug="evaluations">evaluations</DocLink>,{" "}
                  <DocLink slug="automations">workflows</DocLink> and memory.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">owner</td>
                <td className="text-foreground/80">
                  The same operator surfaces, and the last word on membership —
                  owner is the role that can promote and demote other operators.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          &ldquo;Operator&rdquo; throughout these docs means{" "}
          <strong>admin or owner</strong>. Operator-only sections are hidden
          from the settings navigation for members rather than shown and
          refused, so a member&apos;s settings screen is genuinely short.
        </p>
        <Callout tone="tip" title="Roles are not the only fence">
          <p>
            Role decides which screens you get. What an <em>agent</em> may do on
            your behalf is a separate and narrower question, answered by{" "}
            <DocLink slug="approvals-and-guardrails">
              approvals and guardrails
            </DocLink>{" "}
            and by the per-user credentials in{" "}
            <DocLink slug="connectors-and-mcp">connectors</DocLink>. An admin
            with no Google account connected still gets no calendar access.
          </p>
        </Callout>
      </Section>

      <Section id="data-boundaries" title="Data boundaries">
        <p>
          Inside the stack, three stores hold everything, and all three are
          stamped:
        </p>
        <ul>
          <li>
            <strong>Aurora Postgres</strong> — threads, messages, agents,
            spaces, configuration. Every row carries its tenant, and the
            resolvers scope to the caller&apos;s tenant rather than trusting an
            id from the request.
          </li>
          <li>
            <strong>S3</strong> — <Term>agent folder</Term> files, installed
            skills, attachments and artifacts, under a per-tenant key prefix (
            <code>tenants/&lt;tenant&gt;/…</code>). An object key that belongs
            to a different tenant is refused on download, not merely absent from
            the listing.
          </li>
          <li>
            <strong>Agent memory</strong> — managed{" "}
            <DocLink slug="memory">memory</DocLink> is namespaced per agent
            inside the stack, so one agent&apos;s recollections are not another
            agent&apos;s context, let alone another tenant&apos;s.
          </li>
        </ul>
        <p>
          Two smaller boundaries are worth knowing because they surprise people.
          Connector credentials are <strong>per user</strong>, not per tenant —
          your Google token is yours, and an agent acting for a colleague uses
          theirs. And <DocLink slug="spaces">spaces</DocLink> narrow visibility{" "}
          <em>within</em> a tenant: being a member does not mean seeing every
          thread.
        </p>
        <Callout
          tone="warn"
          title="Nothing an agent can reach is inside the boundary by default"
        >
          <p>
            The isolation described here covers what ThinkWork Agent stores. The
            moment an agent calls out through a connector or an MCP server, the
            data lands wherever that system keeps it. That is the intended
            behavior — it is also the reason the interesting review is of{" "}
            <DocLink slug="connectors-and-mcp">what is connected</DocLink>, not
            of the database.
          </p>
        </Callout>
      </Section>

      <Section id="audit-trail" title="The audit trail">
        <p>
          Security-relevant events are recorded to an append-only audit log:
          sign-ins and sign-in failures, invitations and user creation, agents
          created and deleted, skills and MCP servers granted and detached,
          guardrail decisions, approvals, artifact shares created and revoked.
          Deletes are blocked at the database layer rather than by convention,
          and reads are scoped to your own tenant.
        </p>
        <p>
          For day-to-day &ldquo;what did the agent actually do?&rdquo; questions
          the faster surface is <strong>Settings → Activity</strong>, which
          shows threads and turns with their tool calls. The audit log answers
          the different question of who changed the configuration, and when.
        </p>
      </Section>

      <Section id="secrets" title="Secrets, and where compliance lives">
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
        <Callout
          tone="note"
          title="Compliance documentation is maintained separately"
        >
          <p>
            Control descriptions, the compliance module reference and the
            associated runbooks are maintained outside these product docs and
            are available from your operator on request.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
