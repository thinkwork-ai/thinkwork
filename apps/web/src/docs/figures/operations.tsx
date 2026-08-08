/**
 * Figures for the Operations section (THINK-701).
 *
 * Two pictures that prose keeps failing to carry:
 *  - TenancyDiagram — the tenant boundary is the *deployment*, not a column
 *    filter inside a shared cluster. That only lands as a drawing: three
 *    clients, one sign-in, one stack, and every store inside it stamped.
 *  - ModelCatalogDiagram — the catalog is a pipeline (AWS offers → you
 *    import → pricing resolves → you enable), and the gate in the middle is
 *    the part operators trip over.
 *
 * House rules live in ./README.md and ../diagrams.tsx: primitives only, no
 * hardcoded neutrals, 13/11/10px type.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgGroup, DgLabel } from "../diagrams";

/**
 * Tenancy and isolation: users of every client sign in through one Cognito
 * pool, and land in exactly one deployed stack. Nothing in the picture
 * crosses out of the dashed group, which is the point.
 */
export function TenancyDiagram() {
  return (
    <Diagram
      title="Web, mobile and CLI clients sign in through Cognito into a single deployed stack whose database, object storage and agent memory are all scoped to one tenant"
      viewBox="0 0 620 470"
      caption="One deployed stack serves one tenant. The boundary is the deployment itself — there is no shared cluster behind it that a filter could leak across."
    >
      <DgBox
        x={35}
        y={40}
        w={175}
        h={52}
        title="Web app"
        sub="operators + end users"
        tone="consumer"
      />
      <DgBox
        x={222}
        y={40}
        w={175}
        h={52}
        title="Mobile app"
        sub="end users, iOS"
        tone="consumer"
      />
      <DgBox
        x={410}
        y={40}
        w={175}
        h={52}
        title="thinkwork CLI"
        sub="operators"
        tone="consumer"
      />

      <DgArrow d="M122.5 92 L122.5 116 L310 116 L310 138" />
      <DgArrow d="M309.5 92 L309.5 138" />
      <DgArrow d="M497.5 92 L497.5 116 L310 116 L310 138" />

      <DgBox
        x={190}
        y={140}
        w={240}
        h={52}
        title="Cognito"
        sub="sign-in routes published per deployment"
        tone="source"
      />

      <DgArrow
        d="M310 192 L310 228"
        label="identity + tenant"
        labelAt={[310, 210]}
      />

      <DgGroup
        x={35}
        y={230}
        w={550}
        h={210}
        label="Your stack — one stage, one tenant"
      />

      <DgBox
        x={55}
        y={266}
        w={160}
        h={62}
        title="API & runtime"
        sub="GraphQL, agent turns"
        tone="compute"
      />
      <DgBox
        x={232}
        y={266}
        w={156}
        h={62}
        title="Aurora Postgres"
        sub="threads, agents, config"
        tone="storage"
      />
      <DgBox
        x={405}
        y={266}
        w={160}
        h={62}
        title="S3 + memory"
        sub="workspaces, attachments"
        tone="storage"
      />

      <DgChip x={55} y={348} label="tenant_id on every row" tone="storage" />
      <DgChip x={218} y={348} label="tenants/<slug>/..." tone="storage" />
      <DgChip x={365} y={348} label="per-agent namespaces" tone="storage" />

      <DgLabel x={55} y={410} text="nothing in this box resolves outside it" />
    </Diagram>
  );
}

/**
 * The model catalog as the pipeline it actually is. The middle step is the
 * one that surprises people: an imported model with unresolved pricing
 * cannot be enabled at all.
 */
export function ModelCatalogDiagram() {
  return (
    <Diagram
      title="Models flow from the AWS Bedrock catalog through an operator import and a pricing lookup before they can be enabled and selected in the app"
      viewBox="0 0 560 380"
      caption="Import is cheap and reversible; enabling is the gate. A model whose pricing did not resolve stays in your catalog but cannot be turned on."
    >
      <DgBox
        x={130}
        y={20}
        w={300}
        h={58}
        title="Bedrock model catalog"
        sub="what AWS offers in this account and region"
        tone="source"
      />
      <DgArrow
        d="M280 78 L280 108"
        label="operator imports"
        labelAt={[280, 93]}
      />

      <DgBox
        x={130}
        y={110}
        w={300}
        h={58}
        title="Your tenant's catalog"
        sub="the models you chose, with your display names"
        tone="compute"
      />
      <DgArrow
        d="M280 168 L280 198"
        label="AWS Price List"
        labelAt={[280, 183]}
      />

      <DgBox
        x={130}
        y={200}
        w={300}
        h={58}
        title="Pricing resolved"
        sub="input and output cost per million tokens"
        tone="storage"
      />
      <DgArrow d="M280 258 L280 288" label="enable" labelAt={[280, 273]} />

      <DgBox
        x={130}
        y={290}
        w={300}
        h={58}
        title="Selectable in the app"
        sub="agent profiles, and per-user approvals"
        tone="consumer"
      />

      <DgChip x={20} y={220} label="missing" tone="neutral" />
      <DgChip x={20} y={244} label="ambiguous" tone="neutral" />
      <DgLabel x={20} y={210} text="blocked" />
    </Diagram>
  );
}
