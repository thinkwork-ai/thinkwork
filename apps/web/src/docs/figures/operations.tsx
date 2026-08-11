/**
 * Figures for the Operations section (THINK-701), redrawn in the report
 * figure language (2026-08-11 docs overhaul; modeled on memory.tsx's
 * ConsolidationLoopFigure): fill-card boxes with teal strokes, muted
 * edges with italic labels, a unique arrow marker per figure, and no
 * amber — everything drawn here is platform machinery, not a
 * human-in-the-loop step.
 *
 *  - TenancyDiagram (marker `tn-arr`) — the tenant boundary is the
 *    *deployment*, not a column filter inside a shared cluster. Verified
 *    against apps/web + apps/mobile lib/auth-options.ts (all clients ask
 *    /api/auth/options), packages/api/src/lib/workspace-manifest.ts (the
 *    tenants/<slug>/ S3 prefix) and the tenant-scoping tests in
 *    packages/api/src/__tests__/.
 *  - ModelCatalogDiagram (marker `mc-arr`) — the catalog as the pipeline
 *    it is, with the pricing gate drawn as the fork it is. Verified
 *    against apps/web SettingsModelCatalog.tsx (RESOLVED_PRICING gates
 *    the enable switch; manual prices required together) and
 *    packages/api/src/lib/model-catalog/aws-price-list.ts.
 */

/**
 * Tenancy and isolation: every client signs in through one Cognito pool
 * and lands in exactly one deployed stack. Nothing crosses out of the
 * dashed enclosure, which is the point.
 */
export function TenancyDiagram() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 640 452"
          role="img"
          aria-label="Web, mobile and CLI clients sign in through Cognito into a single deployed stack whose database, object storage and agent memory are all scoped to one tenant"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="tn-arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {/* the three clients */}
          <rect x="20" y="20" width="180" height="54" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="36" y="44" className="fill-foreground font-sans text-[13px] font-semibold">Web app</text>
          <text x="36" y="62" className="fill-muted-foreground font-sans text-[11px]">operators + end users</text>

          <rect x="230" y="20" width="180" height="54" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="246" y="44" className="fill-foreground font-sans text-[13px] font-semibold">Mobile app</text>
          <text x="246" y="62" className="fill-muted-foreground font-sans text-[11px]">end users, iOS</text>

          <rect x="440" y="20" width="180" height="54" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="456" y="44" className="fill-foreground font-sans text-[13px] font-semibold">thinkwork CLI</text>
          <text x="456" y="62" className="fill-muted-foreground font-sans text-[11px]">operators</text>

          {/* converging sign-in edges */}
          <path d="M 110 74 L 110 96 L 230 96 L 230 116" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tn-arr)" />
          <line x1="320" y1="74" x2="320" y2="116" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tn-arr)" />
          <path d="M 530 74 L 530 96 L 410 96 L 410 116" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tn-arr)" />

          {/* Cognito */}
          <rect x="140" y="122" width="360" height="54" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="156" y="146" className="fill-foreground font-sans text-[13px] font-semibold">Cognito</text>
          <text x="156" y="164" className="fill-muted-foreground font-sans text-[11px]">sign-in routes published per deployment</text>

          <line x1="320" y1="176" x2="320" y2="216" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tn-arr)" />
          <text x="332" y="202" className="fill-muted-foreground font-sans text-[11px] italic">identity + tenant</text>

          {/* the stack enclosure */}
          <rect x="20" y="234" width="600" height="182" rx="10" className="fill-none stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="5 4" />
          <text x="36" y="262" className="fill-muted-foreground font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">Your stack — one stage, one tenant</text>

          <rect x="40" y="280" width="180" height="86" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="304" className="fill-foreground font-sans text-[13px] font-semibold">API &amp; runtime</text>
          <text x="56" y="322" className="fill-muted-foreground font-sans text-[11px]">GraphQL, agent turns</text>
          <text x="56" y="350" className="fill-muted-foreground font-sans text-[11px] italic">scoped to the caller&apos;s tenant</text>

          <rect x="230" y="280" width="180" height="86" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="246" y="304" className="fill-foreground font-sans text-[13px] font-semibold">Aurora Postgres</text>
          <text x="246" y="322" className="fill-muted-foreground font-sans text-[11px]">threads, agents, config</text>
          <text x="246" y="350" className="fill-muted-foreground font-sans text-[11px] italic">tenant on every row</text>

          <rect x="420" y="280" width="180" height="86" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="436" y="304" className="fill-foreground font-sans text-[13px] font-semibold">S3 + memory</text>
          <text x="436" y="322" className="fill-muted-foreground font-sans text-[11px]">workspaces, attachments</text>
          <text x="436" y="350" className="fill-muted-foreground font-sans text-[11px] italic">tenants/&lt;slug&gt;/… keys</text>

          <text x="36" y="400" className="fill-muted-foreground font-sans text-[11px] italic">nothing in this box resolves outside it</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        One deployed stack serves one tenant. The boundary is the deployment
        itself — there is no shared cluster behind it that a filter could
        leak across.
      </figcaption>
    </figure>
  );
}

/**
 * The model catalog as a pipeline with a real fork in the middle: pricing
 * either resolves and the enable switch unlocks, or it does not and the
 * model stays locked until an operator enters both prices by hand.
 */
export function ModelCatalogDiagram() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 660 402"
          role="img"
          aria-label="Models flow from the Bedrock catalog through an operator import and a pricing lookup; a model whose pricing resolved can be enabled and becomes selectable, while one whose pricing came back missing, ambiguous or errored stays locked until an operator enters both token prices"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="mc-arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          <rect x="100" y="16" width="300" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="116" y="41" className="fill-foreground font-sans text-[13px] font-semibold">Bedrock model catalog</text>
          <text x="116" y="59" className="fill-muted-foreground font-sans text-[11px]">what AWS offers in this account and region</text>

          <line x1="250" y1="72" x2="250" y2="106" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
          <text x="262" y="94" className="fill-muted-foreground font-sans text-[11px] italic">operator imports</text>

          <rect x="100" y="112" width="300" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="116" y="137" className="fill-foreground font-sans text-[13px] font-semibold">Your tenant&apos;s catalog</text>
          <text x="116" y="155" className="fill-muted-foreground font-sans text-[11px]">named by you, disabled by default</text>

          {/* the pricing fork */}
          <path d="M 250 168 L 250 188 L 200 188 L 200 206" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
          <path d="M 250 188 L 530 188 L 530 206" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
          <text x="300" y="182" className="fill-muted-foreground font-sans text-[11px] italic">AWS Price List lookup</text>

          <rect x="60" y="208" width="280" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="76" y="233" className="fill-foreground font-sans text-[13px] font-semibold">Pricing resolved</text>
          <text x="76" y="251" className="fill-muted-foreground font-sans text-[11px]">both token prices known</text>

          <rect x="420" y="208" width="220" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="436" y="233" className="fill-foreground font-sans text-[13px] font-semibold">missing · ambiguous · error</text>
          <text x="436" y="251" className="fill-muted-foreground font-sans text-[11px]">the enable switch stays locked</text>

          <line x1="200" y1="264" x2="200" y2="328" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
          <text x="212" y="300" className="fill-muted-foreground font-sans text-[11px] italic">operator enables</text>

          {/* the unlock path for unpriced models */}
          <path d="M 530 264 L 530 358 L 346 358" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#mc-arr)" />
          <text x="360" y="350" className="fill-muted-foreground font-sans text-[11px] italic">enter both prices, then enable</text>

          <rect x="60" y="330" width="280" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="76" y="355" className="fill-foreground font-sans text-[13px] font-semibold">Selectable in the app</text>
          <text x="76" y="373" className="fill-muted-foreground font-sans text-[11px]">agent configs, per-user approvals, the composer</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Import is cheap and reversible; enabling is the gate. A model whose
        pricing did not resolve stays in the catalog but cannot be turned on
        until both prices are entered by hand.
      </figcaption>
    </figure>
  );
}
