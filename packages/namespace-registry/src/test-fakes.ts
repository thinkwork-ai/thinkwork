/**
 * In-memory fakes for the namespace core tests. No network, no DB.
 */

import type {
  CreateRecordInput,
  DnsRecord,
  NamespaceDnsApi,
} from "./cloudflare.js";
import type { TenantSlugSource } from "./core.js";

export class FakeDns implements NamespaceDnsApi {
  records: DnsRecord[] = [];
  /** Ordered call log: "list:<fqdn>", "create:<type>:<name>", "delete:<id>". */
  calls: string[] = [];
  private nextId = 1;
  /** Race-injection hook: runs immediately after each createRecord. */
  afterCreate: (() => void) | null = null;

  seed(record: Omit<DnsRecord, "id">): DnsRecord {
    const seeded: DnsRecord = { ...record, id: `seed-${this.nextId++}` };
    this.records.push(seeded);
    return seeded;
  }

  async listRecords(fqdn: string): Promise<DnsRecord[]> {
    this.calls.push(`list:${fqdn}`);
    return this.records.filter((r) => r.name === fqdn);
  }

  async createRecord(input: CreateRecordInput): Promise<DnsRecord> {
    this.calls.push(`create:${input.type}:${input.name}`);
    const created: DnsRecord = {
      id: `rec-${this.nextId++}`,
      type: input.type,
      name: input.name,
      content: input.content,
      comment: input.comment,
      ttl: input.ttl,
    };
    this.records.push(created);
    this.afterCreate?.();
    return created;
  }

  async deleteRecord(id: string): Promise<void> {
    this.calls.push(`delete:${id}`);
    this.records = this.records.filter((r) => r.id !== id);
  }

  writes(): string[] {
    return this.calls.filter((c) => !c.startsWith("list:"));
  }
}

export class FakeTenants implements TenantSlugSource {
  slugs: Set<string>;
  calls: string[] = [];
  /** Race-injection hook: runs before each lookup answers. */
  beforeLookup: ((slug: string, callIndex: number) => void) | null = null;

  constructor(slugs: string[] = []) {
    this.slugs = new Set(slugs);
  }

  async slugExists(slug: string): Promise<boolean> {
    this.beforeLookup?.(slug, this.calls.length);
    this.calls.push(slug);
    return this.slugs.has(slug);
  }
}
