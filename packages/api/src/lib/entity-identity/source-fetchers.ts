/**
 * Identity-match source record fetchers (THINK-321 U7, KTD-7).
 *
 * Fetches source rows SERVER-SIDE per registered identity source. One
 * connector kind is supported:
 *
 *   - **Twenty CRM** — company records via the memory-source config
 *     credential path (`checkTwentyReadiness`): the tenant's enabled
 *     twenty memory-source binding supplies the binding key and the
 *     processor owner's token (there is deliberately no tenant-wide user
 *     OAuth to borrow).
 *
 * The analyst Postgres broker fetcher was removed with the analyst
 * data-source subsystem; Company Brain replaces that surface.
 */
import { and, eq } from "drizzle-orm";
import {
  memoryProcessorConfigs,
  memorySourceConfigs,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import type { Database } from "../db.js";
import { checkTwentyReadiness } from "../memory-sources/adapters/twenty.js";
import { TWENTY_MCP_SLUG } from "../twenty/rest-client.js";
import type { IdentityRule } from "./normalizers.js";
import type {
  IdentitySourceRecord,
  SourceFetchArgs,
  SourceFetchResult,
  SourceRecordFetcher,
} from "./bootstrap.js";

const LOG_PREFIX = "[identity-match:fetch]";

const TWENTY_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Twenty fetcher (memory-source config credential path)
// ---------------------------------------------------------------------------

interface TwentyCursor {
  pageToken?: string | null;
}

/** Extract a display string from Twenty's polymorphic field shapes. */
function twentyString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["primaryLinkUrl", "primaryLinkLabel", "name", "url"]) {
      if (typeof record[key] === "string" && record[key]) {
        return record[key] as string;
      }
    }
  }
  return "";
}

export async function fetchTwentySourceRecords(
  args: SourceFetchArgs & { db: Database },
): Promise<SourceFetchResult> {
  const warnings: string[] = [];
  // The memory-source binding is the credential source: the enabled twenty
  // source config names the binding, its processor's creator holds the
  // connected account.
  const [binding] = await args.db
    .select({
      source_binding_key: memorySourceConfigs.source_binding_key,
      created_by_user_id: memoryProcessorConfigs.created_by_user_id,
    })
    .from(memorySourceConfigs)
    .innerJoin(
      memoryProcessorConfigs,
      eq(memorySourceConfigs.processor_config_id, memoryProcessorConfigs.id),
    )
    .where(
      and(
        eq(memorySourceConfigs.tenant_id, args.tenantId),
        eq(memorySourceConfigs.source_family, "twenty"),
        eq(memorySourceConfigs.enabled, true),
      ),
    )
    .limit(1);
  if (!binding?.created_by_user_id) {
    throw new Error(
      "no enabled Twenty memory-source binding (with an owning user) for this tenant — " +
        "connect Twenty as a memory source before running an identity match against it",
    );
  }
  const readiness = await checkTwentyReadiness(args.db as Database, {
    tenantId: args.tenantId,
    userId: binding.created_by_user_id,
    bindingKey: binding.source_binding_key,
  });
  if (!readiness.ready) {
    throw new Error(`Twenty credential unavailable: ${readiness.reason}`);
  }

  // Companies map to ONE entity type; when several types declare twenty,
  // prefer a customer/company-shaped slug and surface the choice.
  const sorted = [...args.entityTypeSlugs].sort();
  const entityTypeSlug =
    sorted.find((slug) => /customer|company|account/.test(slug)) ?? sorted[0]!;
  if (sorted.length > 1) {
    warnings.push(
      `multiple entity types declare twenty (${sorted.join(", ")}) — companies scanned as "${entityTypeSlug}"`,
    );
  }
  const rules = args.rulesByType.get(entityTypeSlug) ?? [];
  const wantsDomain = rules.some((rule) => rule.keyKind === "domain");
  const wantsName = rules.some((rule) => rule.keyKind === "name");

  const records: IdentitySourceRecord[] = [];
  let pageToken = (args.cursor as TwentyCursor | null)?.pageToken ?? null;
  let remaining = args.limit;
  let drained = false;

  while (remaining > 0) {
    const page = await readiness.client.listPage("companies", {
      limit: Math.min(TWENTY_PAGE_SIZE, remaining),
      depth: 0,
      ...(pageToken ? { startingAfter: pageToken } : {}),
    });
    for (const record of page.records) {
      const externalId = typeof record.id === "string" ? record.id : "";
      if (!externalId) continue;
      const name = twentyString(record.name);
      const domain = twentyString(record.domainName);
      const naturalKeys: Array<{ keyKind: string; rawValue: string }> = [];
      if (wantsName && name)
        naturalKeys.push({ keyKind: "name", rawValue: name });
      if (wantsDomain && domain) {
        naturalKeys.push({ keyKind: "domain", rawValue: domain });
      }
      records.push({
        entityTypeSlug,
        externalId,
        displayName: name || externalId,
        naturalKeys,
      });
    }
    remaining -= page.records.length;
    const nextToken =
      page.pageInfo?.hasNextPage && page.pageInfo.endCursor
        ? page.pageInfo.endCursor
        : null;
    if (!nextToken || page.records.length === 0) {
      drained = true;
      pageToken = null;
      break;
    }
    pageToken = nextToken;
  }

  return {
    records,
    cursor: drained ? null : { pageToken },
    drained,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Dispatch by connector kind
// ---------------------------------------------------------------------------

/**
 * The default fetcher: inspect the connector row and dispatch — the Twenty
 * binding goes through the memory-source credential client. Anything else
 * is refused visibly.
 */
export function createDefaultSourceRecordFetcher(
  db: Database = defaultDb,
): SourceRecordFetcher {
  return async (args: SourceFetchArgs): Promise<SourceFetchResult> => {
    const [connector] = await db
      .select({
        slug: tenantMcpServers.slug,
        managed_application_key: tenantMcpServers.managed_application_key,
      })
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.tenant_id, args.tenantId),
          eq(tenantMcpServers.slug, args.connectorSlug),
        ),
      )
      .limit(1);
    if (!connector) {
      throw new Error(
        `connector "${args.connectorSlug}" no longer exists for this tenant`,
      );
    }

    const isTwenty =
      connector.slug === TWENTY_MCP_SLUG ||
      connector.managed_application_key === "twenty";
    if (isTwenty) {
      return fetchTwentySourceRecords({ ...args, db });
    }

    throw new Error(
      `connector "${args.connectorSlug}" is not the Twenty binding — ` +
        "identity-match has no fetcher for this connector kind",
    );
  };
}
