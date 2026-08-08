/**
 * Model catalog (Operations) — THINK-701.
 *
 * Verified against apps/web SettingsModelCatalog.tsx (columns, the import
 * dialog, the details dialog and its enable Switch), ModelSelect.tsx (agent
 * profiles read the *enabled* catalog), UserModelsSection.tsx (per-user
 * approvals live on Settings → Users → a user), and the
 * TenantModelCatalogEntry / BedrockModelImportCandidate types in
 * packages/database-pg/graphql/types/agents.graphql.
 *
 * The non-obvious rule this page exists to state: pricing is a hard gate on
 * enabling a model, and the enable toggle is disabled until it resolves.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import { ModelCatalogDiagram } from "../figures/operations";
import type { DocTocEntry } from "../registry";

export const MODEL_CATALOG_TOC: DocTocEntry[] = [
  { id: "the-catalog", title: "The catalog" },
  { id: "importing", title: "Importing a model" },
  { id: "pricing", title: "Pricing is the gate" },
  { id: "choosing-a-model", title: "Choosing a model" },
  { id: "cost-and-limits", title: "Cost and limits" },
];

export function ModelCatalog() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="Model catalog"
      lead="The model catalog is the set of models your tenant has approved, and the rules that decide which one runs a given turn."
    >
      <Section id="the-catalog" title="The catalog">
        <p>
          Every model ThinkWork Agent can call comes from{" "}
          <strong>Amazon Bedrock</strong> in your own account. The catalog at{" "}
          <strong>Settings → Model Catalog</strong> is the operator&apos;s
          shortlist of those: the models you have imported, named, priced and —
          for some of them — enabled.
        </p>
        <p>
          Two things follow from that. Nothing is available just because AWS
          offers it, and nothing leaves your account to be evaluated: model
          access is a Bedrock permission in the same account the stack is
          deployed to, which is why a model you can see in the AWS console but
          not here usually means model access has not been requested in Bedrock
          yet.
        </p>
        <ModelCatalogDiagram />
        <p>
          The list itself is deliberately plain — display name, provider, model
          id, and input and output cost per million tokens. Click a row for the
          details drawer, which is where you rename it, correct pricing, and
          turn it on or off.
        </p>
      </Section>

      <Section id="importing" title="Importing a model">
        <p>
          <strong>Import</strong> opens the list of Bedrock models available in
          this account and region, each already annotated with what it supports
          and what AWS charges for it. Tick the ones you want, give them display
          names your team will recognize, and import.
        </p>
        <p>
          Importing is cheap and reversible: an imported model is{" "}
          <strong>disabled by default</strong>, so nothing changes for anyone
          until you deliberately enable it. Models already in your catalog are
          marked in the import list and cannot be double-imported.
        </p>
        <Callout tone="tip" title="Import a small, opinionated set">
          <p>
            The catalog is a menu people choose from, and a menu of forty
            near-identical entries is a worse menu. A fast cheap model, a strong
            default, and one long-context or vision model covers most tenants.
            You can always import more later.
          </p>
        </Callout>
      </Section>

      <Section id="pricing" title="Pricing is the gate">
        <p>
          When you import, the platform resolves each model&apos;s token pricing
          from the AWS Price List and records where the numbers came from and
          when. That status is not decorative — it is the condition on being
          able to turn the model on:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Pricing status</th>
                <th className="px-3 py-2 font-medium">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">resolved</td>
                <td className="text-foreground/80">
                  Input and output cost per million tokens are known. This is
                  the only status that can be enabled.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">missing</td>
                <td className="text-foreground/80">
                  The Price List had no entry for this model in this region.
                  Common for very new models.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">ambiguous</td>
                <td className="text-foreground/80">
                  More than one price matched and the platform refused to guess.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">error</td>
                <td className="text-foreground/80">
                  The lookup itself failed. Worth retrying before entering
                  prices by hand.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          For anything other than <code>resolved</code>, open the model&apos;s
          details drawer and enter the input and output prices yourself. They
          are required <strong>together</strong> — a half-priced model is worse
          than an unpriced one, because it silently under-reports spend. Once
          both are set, the enable switch unlocks.
        </p>
        <Callout tone="warn" title="Why enabling is gated on price">
          <p>
            Every turn&apos;s cost is computed from the catalog&apos;s numbers.
            A model with no pricing would run happily and report zero spend,
            which quietly breaks per-user budgets and every cost view in the
            product. The gate is there so that a cost report is never a guess.
          </p>
        </Callout>
      </Section>

      <Section id="choosing-a-model" title="Choosing a model">
        <p>
          Enabling a model does not point anything at it. It makes it{" "}
          <em>selectable</em>, in three places:
        </p>
        <ul>
          <li>
            <strong>An agent&apos;s configuration.</strong> Each{" "}
            <Term>agent</Term> names the model it runs on. The picker lists only
            enabled models, and flags one that is incompatible with the
            agent&apos;s runtime rather than hiding it — so a mismatch is
            visible instead of mysterious.
          </li>
          <li>
            <strong>Per-user approval.</strong> On{" "}
            <strong>Settings → Users → a user</strong>, each enabled model can
            be approved or withheld for that person. This is how a small
            expensive model stays available to a few people without leaving the
            catalog.
          </li>
          <li>
            <strong>The composer.</strong> When someone has more than one
            approved model, a model picker appears next to the message input and
            they can override for a single turn. With one approved model there
            is no picker and nothing to think about.
          </li>
        </ul>
        <p>
          Changes take effect on the <strong>next turn</strong>, not on
          in-flight ones. There is nothing to redeploy and no cache to clear —
          the pickers read the catalog live.
        </p>
        <Callout tone="warn" title="Disabling a model an agent is pointed at">
          <p>
            Disabling removes a model from every picker, but it does not
            re-point agents that already name it. Before you turn one off, check
            which agents use it and move them — otherwise you find out from a
            failed turn.
          </p>
        </Callout>
      </Section>

      <Section id="cost-and-limits" title="Cost and limits">
        <p>
          Because the catalog carries prices, the platform can price every turn
          as it happens. That feeds the usage figures on a user&apos;s page and
          the monthly budget you can set there — a per-person ceiling, expressed
          in dollars, rather than an abstract token quota.
        </p>
        <p>
          The catalog also records what each model is capable of — context
          window, maximum output tokens, whether it supports tool use and
          images. Those matter more than they look: an agent with{" "}
          <DocLink slug="skills">skills</DocLink> or{" "}
          <DocLink slug="connectors-and-mcp">connectors</DocLink> needs a
          tool-capable model, and reading attachments needs a vision-capable
          one.
        </p>
        <Callout tone="note" title="Rate limits are Bedrock's, not ours">
          <p>
            Throughput ceilings and quota errors come from Bedrock in your
            account and region. If a model throttles under load, the fix is a
            Bedrock quota increase — or a second enabled model to route heavy
            work to — not a setting here.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
