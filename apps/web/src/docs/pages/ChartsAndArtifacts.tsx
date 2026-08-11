/**
 * Charts & artifacts (Tools & integrations) — THINK-699.
 *
 * The "what comes back" page: two mechanisms with genuinely different
 * lifetimes — a chart is part of a message, an artifact outlives the
 * thread.
 *
 * Report restyle (2026-08-11). Claims verified against the shipped code:
 * packages/chart-renderer/src/types.ts + validate.ts (the seven forms,
 * required title, 24-point cap), packages/pi-runtime-core/src/
 * chart-runtime.ts (always-on registration, caption-as-takeaway guidance,
 * four distinct charts per turn, grounding rejection text) and
 * provenance.ts (tracing against this turn's tool results and the user's
 * own message, derived-value tolerance), apps/web/src/components/
 * workbench/{render-typed-part,ChartCard}.tsx and apps/mobile/components/
 * chat/ChartCard.tsx (one shared renderer; web inline cards per
 * THINK-686; the mobile detail sheet), packages/api/src/lib/artifacts/
 * document-directives.ts (document figures + foldaway data table),
 * document-compositor.ts (markdown in, sanitized house HTML out),
 * document-emission.ts + born-artifact.ts (born-as-draft, the card
 * payload, idempotent re-emission), binding-capture.ts +
 * canvas-refresh-core.ts (widget bindings; headless refresh; per-user
 * credentials never used unattended; schema-stale escalation),
 * artifact-shares.ts + mintArtifactShareLink / revokeArtifactShareLink /
 * artifactShares resolvers (documents-only public links, revocation,
 * operator listing), and packages/database-pg schema artifacts.ts
 * (status, versions, nullable space_id for drafts).
 *
 * Dropped from the pre-restyle page: "web transcripts do not draw the
 * chart card today" (superseded — THINK-686 renders data-chart parts
 * inline on web) and "document authoring is a skill that must be
 * installed" (emit_document registration is unconditional; the
 * document-composer skill is a workspace default seeded everywhere).
 */
import {
  DocLink,
  DocTable,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const CHARTS_AND_ARTIFACTS_TOC: DocTocEntry[] = [
  { id: "two-shapes", title: "Two shapes of durable output" },
  { id: "inline-charts", title: "Inline charts" },
  { id: "where-charts-render", title: "Where a chart renders" },
  { id: "artifacts", title: "Artifacts" },
  { id: "refresh", title: "Keeping an artifact current" },
  { id: "sharing", title: "Sharing and export" },
];

export function ChartsAndArtifacts() {
  return (
    <ReportArticle
      eyebrow="Tools & integrations"
      title="Charts & artifacts"
      lead="Not every answer is a paragraph. A chart is a picture of numbers the agent just computed, inside the message. An artifact is a deliverable with a name, a version history and a home — it outlives the conversation that produced it."
    >
      <ReportSection id="two-shapes" title="Two shapes of durable output">
        <DocTable
          head={["", "Chart", "Artifact"]}
          rows={[
            [
              <strong>Lives in</strong>,
              "The message — it is part of the reply",
              <>
                A <DocLink slug="spaces">Space</DocLink>, with its own page
              </>,
            ],
            [
              <strong>Lifetime</strong>,
              "As long as the thread",
              "Outlives the thread; editable from later threads",
            ],
            [
              <strong>Versions</strong>,
              "None — re-ask, re-draw",
              "A linear version history you can read back",
            ],
            [
              <strong>Availability</strong>,
              "Always on for every agent",
              "Always on; authoring guidance ships as a default skill",
            ],
          ]}
        />
        <p>
          The choice is not usually yours to make explicitly — the agent picks
          — but knowing the difference tells you where to look afterwards. A
          chart is found by scrolling the thread. An artifact is found in the
          Artifacts list, whether or not you remember which conversation made
          it.
        </p>
      </ReportSection>

      <ReportSection id="inline-charts" title="Inline charts">
        <p>
          When an answer is numeric, the agent can draw it instead of listing
          it. Seven forms are available, and the agent is told to pick by the
          shape of the question rather than by taste:
        </p>
        <DocTable
          head={["Form", "For"]}
          rows={[
            [<code>bar</code>, "Comparison across categories"],
            [<code>line</code>, "Change over time"],
            [<code>donut</code>, "Parts of a whole"],
            [<code>stat-strip</code>, "A short row of headline numbers"],
            [<code>sparkline</code>, "A compact trend"],
            [<code>meter</code>, "Progress toward a target"],
            [<code>funnel</code>, "Stage-to-stage drop-off"],
          ]}
        />
        <p>
          Every chart carries a title, and the caption the agent is told to
          write is the <em>takeaway</em> — &quot;qualification is the biggest
          drop-off&quot;, not &quot;this chart shows the pipeline&quot;. A
          chart holds up to 24 points, and a turn draws at most four distinct
          charts: a turn that wants more than four is building a dashboard,
          and the right home for that is an artifact.
        </p>
        <Invariant title="A chart cannot be invented">
          <p>
            Charted numbers are checked against what the turn actually saw. If
            a value does not trace back to a tool result from this turn — or
            to numbers you gave the agent in your own message — the chart is
            rejected and the agent is told to redraw it from the data it
            really has. Derived values pass too: a percentage, a delta, or the
            same figure re-expressed in millions still counts as traced. What
            gets refused is memory — asking the agent to &quot;chart what you
            remember&quot; correctly gets you prose, while pasting six months
            of revenue into the thread gets you a chart of exactly those
            numbers.
          </p>
        </Invariant>
        <p>
          One renderer draws all of them, so a chart looks identical wherever
          it appears — same palette, same type, light or dark. That renderer
          is also the one used inside documents, which is why a report&apos;s
          figures match the cards you see in chat.
        </p>
      </ReportSection>

      <ReportSection id="where-charts-render" title="Where a chart renders">
        <p>
          Charts are emitted as a structured part of the message, not as an
          image, and each surface draws them for itself:
        </p>
        <ul>
          <li>
            <strong>Web threads</strong> — a chart card inline in the
            transcript, drawn by the shared renderer.
          </li>
          <li>
            <strong>Mobile</strong> — the same card inline in the
            conversation. Tap it and a detail sheet slides in with the
            full-size chart and its underlying numbers.
          </li>
          <li>
            <strong>Documents</strong> — figures inside a report or brief, on
            any surface that opens the document, each paired with a foldaway
            data table.
          </li>
        </ul>
        <p>
          Because the card is supposed to carry the numbers, the agent is
          instructed not to repeat a charted series as a table in its prose —
          the takeaway sentence and the card together are the answer.
        </p>
      </ReportSection>

      <ReportSection id="artifacts" title="Artifacts">
        <p>
          An <Term>artifact</Term> is the deliverable, as distinct from the
          discussion about the deliverable. It has a title, a type, a status
          (draft, final or superseded), a version history, and a saved
          artifact belongs to a Space rather than to the thread that happened
          to create it. Two kinds are in regular use:
        </p>
        <ul>
          <li>
            <strong>Documents</strong> — reports, plans, briefs, ideation
            write-ups. The agent writes markdown; the platform compiles it
            into the house-styled page you read, dropping any HTML the model
            tries to author along the way. Documents cannot run code, by
            construction, which is what makes them safe to share outward.
          </li>
          <li>
            <strong>Canvases</strong> — interactive views over live data,
            where each widget remembers the tool call that produced its
            numbers.
          </li>
        </ul>
        <PullQuote who="the lifecycle, in one sentence">
          Both kinds are born as artifacts — they exist from the moment the
          agent emits them, as a draft, rather than being promoted out of a
          transcript afterwards.
        </PullQuote>
        <p>
          In the thread you get a compact card at the end of the reply — the
          card is the pointer, not the deliverable. Clicking it opens the
          artifact beside the conversation, and asking for a change in chat
          re-emits it in place under the same identity. The{" "}
          <strong>Artifacts</strong> list is the other way in, and the one to
          use when you remember the document but not the conversation.
        </p>
      </ReportSection>

      <ReportSection id="refresh" title="Keeping an artifact current">
        <p>
          A canvas widget built from a tool result keeps the call that
          produced it, so refreshing does not mean re-authoring. What happens
          when you press Refresh depends on whose credential the data came
          from:
        </p>
        <ul>
          <li>
            <strong>Tenant-credentialed data</strong> refreshes headlessly —
            the saved call re-runs and the numbers update in seconds, with no
            agent turn involved.
          </li>
          <li>
            <strong>Data behind your personal connection</strong> refreshes
            under <em>your</em> credential when you are the one clicking, and
            never unattended. A scheduled refresh does not reach into
            anyone&apos;s personal OAuth; see{" "}
            <DocLink slug="connectors-and-mcp">
              Connectors &amp; MCP tools
            </DocLink>{" "}
            for why.
          </li>
          <li>
            <strong>A changed data shape</strong> escalates to the agent,
            which re-authors the widget rather than forcing new data into an
            old layout.
          </li>
        </ul>
        <p>
          Documents have no data bindings — a document is a statement about a
          moment. Bringing one up to date means the agent re-authoring it,
          which produces a new version while the old one stays in the history;
          a scheduled run can do that re-authoring for a standing report.
        </p>
      </ReportSection>

      <ReportSection id="sharing" title="Sharing and export">
        <ul>
          <li>
            <strong>Inside the workspace</strong> — send the artifact&apos;s
            URL. Everyone who can already open the artifact will; nobody else
            will. There is nothing to mint.
          </li>
          <li>
            <strong>Outside the workspace</strong> — a document can be given a
            public &quot;anyone with the link&quot; URL. It is available for
            documents only, precisely because a document cannot execute code,
            and it can be revoked: once revoked, the link is dead for everyone
            holding it.
          </li>
          <li>
            <strong>A public link stays live.</strong> It serves the current
            document, so later edits become visible to everyone holding the
            URL. That is the intended behaviour, and it is also the thing to
            think about before sending one outside: a link you shared as a
            finished report will show whatever the document says next week.
          </li>
          <li>
            <strong>Charts</strong> travel inside whatever carries them. To
            send a chart to someone outside the workspace, ask for the
            document it belongs in and share that.
          </li>
        </ul>
        <p>
          Operators can see every public link that exists for the tenant and
          revoke any of them — a share is a tenant-visible act, not a private
          one.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
