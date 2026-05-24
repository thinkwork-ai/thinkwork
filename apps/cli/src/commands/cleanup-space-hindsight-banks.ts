import { execFileSync } from "node:child_process";
import { Command } from "commander";

export interface SpaceHindsightBank {
  bankId: string;
  rowCount: number;
}

export interface CleanupSpaceHindsightBanksSummary {
  stage: string;
  apply: boolean;
  banks: SpaceHindsightBank[];
  deletedTables: Array<{ table: string; deleted: number }>;
}

export interface SpaceHindsightBankStore {
  listSpaceBanks(): Promise<SpaceHindsightBank[]>;
  deleteSpaceBanks(
    bankIds: string[],
  ): Promise<Array<{ table: string; deleted: number }>>;
}

const BANK_ID_TABLES = [
  "async_operations",
  "audit_log",
  "chunks",
  "directives",
  "memory_links",
  "memory_units",
  "entities",
  "mental_models",
  "webhooks",
  "documents",
  "banks",
] as const;

export function registerCleanupSpaceHindsightBanksCommand(
  program: Command,
): void {
  program
    .command("cleanup-space-hindsight-banks")
    .description("List or delete retired per-Space Hindsight banks.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--database-url <url>", "Postgres DATABASE_URL override")
    .option("--apply", "Delete matching space_* Hindsight rows")
    .action(async (opts, cmd) => {
      const parent = cmd.parent as Command | undefined;
      const stage = opts.stage ?? parent?.opts().stage ?? "";
      const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? "";
      if (!stage) throw new Error("--stage is required");
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required. Pass --database-url or set DATABASE_URL.",
        );
      }
      const apply = Boolean(opts.apply);
      if (apply && !isNonProductionStage(stage)) {
        throw new Error("--apply is only allowed for dev/test/local stages.");
      }

      const summary = await cleanupSpaceHindsightBanks({
        stage,
        apply,
        store: new PsqlSpaceHindsightBankStore(databaseUrl),
      });
      console.log(JSON.stringify(summary, null, 2));
    });
}

export async function cleanupSpaceHindsightBanks(input: {
  stage: string;
  apply: boolean;
  store: SpaceHindsightBankStore;
}): Promise<CleanupSpaceHindsightBanksSummary> {
  const banks = await input.store.listSpaceBanks();
  const deletedTables =
    input.apply && banks.length > 0
      ? await input.store.deleteSpaceBanks(banks.map((bank) => bank.bankId))
      : [];
  return {
    stage: input.stage,
    apply: input.apply,
    banks,
    deletedTables,
  };
}

export class PsqlSpaceHindsightBankStore implements SpaceHindsightBankStore {
  constructor(private readonly databaseUrl: string) {}

  async listSpaceBanks(): Promise<SpaceHindsightBank[]> {
    const sql = `
      WITH bank_ids AS (
        SELECT bank_id FROM hindsight.banks WHERE bank_id LIKE 'space_%'
        UNION
        SELECT bank_id FROM hindsight.memory_units WHERE bank_id LIKE 'space_%'
      )
      SELECT b.bank_id, COALESCE(COUNT(mu.id), 0)::int AS row_count
      FROM bank_ids b
      LEFT JOIN hindsight.memory_units mu ON mu.bank_id = b.bank_id
      GROUP BY b.bank_id
      ORDER BY b.bank_id;
    `;
    const out = this.psql(sql);
    if (!out.trim()) return [];
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [bankId, count] = line.split("|");
        return { bankId: bankId ?? "", rowCount: Number(count ?? 0) };
      })
      .filter((bank) => bank.bankId.startsWith("space_"));
  }

  async deleteSpaceBanks(
    bankIds: string[],
  ): Promise<Array<{ table: string; deleted: number }>> {
    if (bankIds.length === 0) return [];
    const arrayLiteral = `ARRAY[${bankIds.map(sqlString).join(",")}]`;
    return BANK_ID_TABLES.map((table) => {
      const out = this.psql(
        `WITH deleted AS (
           DELETE FROM hindsight.${table}
           WHERE bank_id = ANY(${arrayLiteral})
           RETURNING 1
         )
         SELECT COUNT(*)::int FROM deleted;`,
      ).trim();
      return { table, deleted: Number(out || 0) };
    });
  }

  private psql(sql: string): string {
    return execFileSync(
      "psql",
      [this.databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-c", sql],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  }
}

function isNonProductionStage(stage: string): boolean {
  return /^(dev|test|local)(-|$)/i.test(stage);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
