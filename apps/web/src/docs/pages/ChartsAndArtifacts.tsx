/**
 * Charts & artifacts (Tools & integrations) — THINK-699.
 *
 * The "what comes back" page. Two mechanisms with genuinely different
 * lifetimes — a chart is part of a message, an artifact outlives the thread —
 * and one honest platform caveat (chart cards render on mobile today, not in
 * web transcripts) that readers will otherwise discover the hard way.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
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
    <DocArticle
      eyebrow="Tools & integrations"
      title="Charts & artifacts"
      lead="Not every answer is a paragraph. A chart is a picture of numbers the agent just computed, inside the message. An artifact is a deliverable with a name, a version history and a home — it outlives the conversation that produced it."
    >
      <Section id="two-shapes" title="Two shapes of durable output">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">&nbsp;</th>
                <th className="px-3 py-2 font-medium">Chart</th>
                <th className="px-3 py-2 font-medium">Artifact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Lives in</td>
                <td className="text-foreground/80">
                  The message — it is part of the reply
                </td>
                <td className="text-foreground/80">
                  A <DocLink slug="spaces">Space</DocLink>, with its own page
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Lifetime</td>
                <td className="text-foreground/80">As long as the thread</td>
                <td className="text-foreground/80">
                  Outlives the thread; editable from later threads
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Versions</td>
                <td className="text-foreground/80">None — re-ask, re-draw</td>
                <td className="text-foreground/80">
                  A linear version history you can read back
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Availability</td>
                <td className="text-foreground/80">
                  Always on for every agent
                </td>
                <td className="text-foreground/80">
                  Needs the authoring skill installed
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The choice is not usually yours to make explicitly — the agent picks —
          but knowing the difference tells you where to look afterwards. A chart
          is found by scrolling the thread. An artifact is found in the
          Artifacts list, whether or not you remember which conversation made
          it.
        </p>
      </Section>

      <Section id="inline-charts" title="Inline charts">
        <p>
          When an answer is numeric, the agent can draw it instead of listing
          it. Seven forms are available, and the agent is told to pick by the
          shape of the question rather than by taste:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Form</th>
                <th className="px-3 py-2 font-medium">For</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">bar</td>
                <td className="text-foreground/80">
                  Comparison across categories
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">line</td>
                <td className="text-foreground/80">Change over time</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">donut</td>
                <td className="text-foreground/80">Parts of a whole</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  stat-strip
                </td>
                <td className="text-foreground/80">
                  A short row of headline numbers
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  sparkline
                </td>
                <td className="text-foreground/80">A compact trend</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">meter</td>
                <td className="text-foreground/80">Progress toward a target</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">funnel</td>
                <td className="text-foreground/80">Stage-to-stage drop-off</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Every chart carries a title and a caption, and the caption is written
          to be the <em>takeaway</em> — &quot;qualification is the biggest
          drop-off&quot;, not &quot;this chart shows the pipeline&quot;. A chart
          holds up to 24 points, and a turn draws at most four: a turn that
          wants more than four is building a dashboard, and the right home for
          that is an artifact.
        </p>
        <Callout tone="tip" title="A chart cannot be invented">
          <p>
            Charted numbers are checked against what the turn actually saw. If a
            value does not trace back to a tool result from this turn — or to
            numbers you gave the agent in your own message — the chart is
            rejected and the agent is told to redraw it from the data it really
            has. So a chart is evidence its numbers came from somewhere real: a
            lookup that happened, or figures you supplied. Derived values pass
            too — a percentage, delta, or the same figure re-expressed in
            millions still counts as traced. What gets refused is memory: asking
            the agent to &quot;chart what you remember&quot; correctly gets you
            prose instead, while pasting six months of revenue into the thread
            gets you a chart of exactly those numbers.
          </p>
        </Callout>
        <p>
          One renderer draws all of them, so a chart looks identical wherever it
          appears — same palette, same type, light or dark. That renderer is
          also the one used inside documents, which is why a report&apos;s
          figures match the cards you saw in chat.
        </p>
      </Section>

      <Section id="where-charts-render" title="Where a chart renders">
        <p>
          Charts are emitted as a structured part of the message, not as an
          image, and each surface draws them for itself:
        </p>
        <ul>
          <li>
            <strong>Mobile</strong> — a chart card inline in the conversation.
            Tap it and a detail sheet slides in with the full-size chart and its
            underlying numbers.
          </li>
          <li>
            <strong>Documents</strong> — figures inside a report or brief, on
            any surface that opens the document, each paired with a foldaway
            data table.
          </li>
          <li>
            <strong>Web threads</strong> — <strong>not yet</strong>. A chart
            emitted into a web conversation is stored on the message, and the
            reply text stands on its own, but the web transcript does not draw
            the card today. Open the thread on{" "}
            <DocLink slug="mobile-app">mobile</DocLink> to see it, or ask for a
            report if you need the visual on a desktop.
          </li>
        </ul>
        <Callout
          tone="note"
          title="Why the reply still reads correctly without the picture"
        >
          <p>
            The agent is instructed not to repeat a charted series as a table in
            its prose — the card is supposed to carry the numbers. On a surface
            that does not draw the card, that leaves a takeaway sentence without
            its figures. If an answer feels thin on a desktop, it is worth
            asking for the numbers explicitly rather than assuming they were
            never computed.
          </p>
        </Callout>
      </Section>

      <Section id="artifacts" title="Artifacts">
        <p>
          An <Term>artifact</Term> is the deliverable, as distinct from the
          discussion about the deliverable. It has a title, a type, a status
          (draft, final or superseded), a version history, and it belongs to a
          Space rather than to the thread that happened to create it. Two kinds
          are in regular use:
        </p>
        <ul>
          <li>
            <strong>Documents</strong> — reports, plans, briefs, ideation
            write-ups. The agent writes markdown; the platform compiles it into
            the house-styled page you read. Documents cannot run code, by
            construction, which is what makes them safe to share outward.
          </li>
          <li>
            <strong>Canvases</strong> — interactive views over live data, where
            each widget remembers the tool call that produced its numbers.
          </li>
        </ul>
        <p>
          Both are <strong>born as artifacts</strong>: they exist from the
          moment the agent emits them, as a draft, rather than being promoted
          out of a transcript afterwards. In the thread you get a compact card
          at the end of the reply — the card is the pointer, not the
          deliverable. Clicking it opens the artifact beside the conversation,
          and asking for a change in chat re-emits it in place.
        </p>
        <p>
          The <strong>Artifacts</strong> list is the other way in, and the one
          to use when you remember the document but not the conversation.
        </p>
        <Callout tone="warn" title="If documents come back as chat text">
          <p>
            Document authoring is a skill, not a built-in. If you ask for a
            report and get a wall of markdown in the reply instead of a document
            card, the authoring skill is not installed on that agent (or has not
            passed review) — check <DocLink slug="skills">Skills</DocLink>{" "}
            first. Charts are the opposite case: always available, never
            installed.
          </p>
        </Callout>
      </Section>

      <Section id="refresh" title="Keeping an artifact current">
        <p>
          A canvas widget built from a tool result keeps the call that produced
          it, so refreshing does not mean re-authoring. What happens when you
          press Refresh depends on whose credential the data came from:
        </p>
        <ul>
          <li>
            <strong>Tenant-credentialed data</strong> refreshes headlessly — the
            saved call re-runs and the numbers update in seconds, with no agent
            turn involved.
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
            <strong>A changed data shape</strong> escalates to the agent, which
            re-authors the widget rather than forcing new data into an old
            layout.
          </li>
        </ul>
        <p>
          Documents have no bindings and nothing to refresh — a document is a
          statement about a moment. When the moment changes, ask for a new
          version; the old one stays in the history.
        </p>
      </Section>

      <Section id="sharing" title="Sharing and export">
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
            document, so later edits become visible to everyone holding the URL.
            That is the intended behaviour, and it is also the thing to think
            about before sending one outside: a link you shared as a finished
            report will show whatever the document says next week.
          </li>
          <li>
            <strong>Charts</strong> travel inside whatever carries them. To send
            a chart to someone outside the workspace, ask for the document it
            belongs in and share that.
          </li>
        </ul>
        <p>
          Operators can see every public link that exists for the tenant and
          revoke any of them — a share is a tenant-visible act, not a private
          one.
        </p>
      </Section>
    </DocArticle>
  );
}
