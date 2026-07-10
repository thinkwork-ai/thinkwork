/**
 * Read-only access to LastMile's dispatch Postgres for the Twenty migration.
 *
 * Per plan KTD8: plain `pg` connection from LASTMILE_DATABASE_URL with the
 * session forced read-only and a statement timeout, following
 * docs/solutions/security/analyst-external-postgres-role-provisioning-runbook-2026-07.md.
 * Read queries never mutate LastMile.
 *
 * Entity shapes were read from the live `dispatch` database on 2026-07-09 (see
 * the plan's Outstanding Questions resolutions): leads and opportunities are
 * separate tables; CRM notes are `task_comment` rows on lead/opportunity tasks;
 * the `note` table targets dispatch `customer` rows, which only reach Twenty
 * through an exact-unique-name match to a CRM `account`.
 */

import pg from "pg";

export interface LastmileRep {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** LastMile short username, e.g. "jbake" — owner refs sometimes use it. */
  alias: string | null;
  email: string | null;
  archived: boolean;
  userIsActive: boolean | null;
}

export interface LastmileAccount {
  id: string;
  name: string | null;
  ownerRepId: string | null;
}

export interface LastmileContact {
  id: string;
  accountId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  phoneCellular: string | null;
  title: string | null;
}

export interface LastmileLead {
  id: string;
  status: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  description: string | null;
  ownerRepId: string | null;
  dateCreated: Date | null;
}

export interface LastmileOpportunity {
  id: string;
  name: string | null;
  stage: string | null;
  amount: string | null;
  quantity: string | null;
  productType: string | null;
  brand: string | null;
  closed: string | null;
  won: string | null;
  accountId: string | null;
  ownerRepId: string | null;
  expectedCloseDate: string | null;
  description: string | null;
  dateCreated: Date | null;
}

/**
 * A product line on an opportunity. LastMile keeps them as a JSON array at
 * `task.entity_data->'items'` on the opportunity's task row — 816 of 2,971
 * opportunities have one, and 82 carry 2-5 lines. `brand` is the product
 * ("MOBIL", "GOLDEN WEST", "DEF"); the opportunity row's own `product_type`
 * is the coarser category ("Fuel", "Equipment").
 */
export interface LastmileOpportunityItem {
  /** Owning opportunity id (lead/opportunity entity_id on the task row). */
  opportunityId: string;
  /** Position within the items array — part of the line's stable identity. */
  index: number;
  brand: string | null;
  quantity: string | null;
  amount: string | null;
}

export interface LastmileCrmComment {
  id: string;
  entityType: "lead" | "opportunity";
  entityId: string;
  content: string | null;
  isDeleted: boolean;
  createdAt: Date | null;
}

export interface LastmileCrmAttachment {
  id: string;
  entityType: "lead" | "opportunity";
  entityId: string;
  filename: string | null;
  filePath: string | null;
  fileType: string | null;
  bucketName: string | null;
}

export interface LastmileCustomerNote {
  id: string;
  noteText: string | null;
  customerId: string;
  customerName: string | null;
  /** Set only when exactly one account matches the customer name. */
  matchedAccountId: string | null;
  dateCreated: Date | null;
}

export interface LastmileReader {
  readReps(): Promise<LastmileRep[]>;
  readAccounts(): Promise<LastmileAccount[]>;
  readContacts(): Promise<LastmileContact[]>;
  readLeads(): Promise<LastmileLead[]>;
  readOpportunities(): Promise<LastmileOpportunity[]>;
  readOpportunityItems(): Promise<LastmileOpportunityItem[]>;
  readCrmComments(): Promise<LastmileCrmComment[]>;
  readCrmAttachments(): Promise<LastmileCrmAttachment[]>;
  readCustomerNotes(): Promise<LastmileCustomerNote[]>;
  close(): Promise<void>;
}

export function createLastmileReader(databaseUrl: string): LastmileReader {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    options: "-c default_transaction_read_only=on -c statement_timeout=60000",
  });

  async function rows<T>(sql: string): Promise<T[]> {
    const result = await pool.query(sql);
    return result.rows as T[];
  }

  return {
    readReps: () =>
      rows<LastmileRep>(`
        select sr.id,
               sr.first_name  as "firstName",
               sr.last_name   as "lastName",
               nullif(trim(sr.alias), '') as "alias",
               lower(trim(coalesce(nullif(sr.email_address, ''), u.email))) as "email",
               coalesce(sr.archived, false) as "archived",
               u.is_active    as "userIsActive"
        from sales_rep sr
        left join users u on u.id = sr.user_id
        order by sr.id
      `),
    readAccounts: () =>
      rows<LastmileAccount>(`
        select id, nullif(trim(name), '') as "name", nullif(owner, '') as "ownerRepId"
        from account
        order by id
      `),
    readContacts: () =>
      rows<LastmileContact>(`
        select id,
               nullif(account_id, '')      as "accountId",
               nullif(trim(first_name), '') as "firstName",
               nullif(trim(last_name), '')  as "lastName",
               nullif(trim(email_address), '') as "email",
               nullif(trim(phone), '')     as "phone",
               nullif(trim(phone_cellular), '') as "phoneCellular",
               nullif(trim(title), '')     as "title"
        from contact
        order by id
      `),
    readLeads: () =>
      rows<LastmileLead>(`
        select id,
               nullif(trim(status), '')     as "status",
               nullif(trim(company), '')    as "companyName",
               nullif(trim(first_name), '') as "firstName",
               nullif(trim(last_name), '')  as "lastName",
               nullif(trim(email), '')      as "email",
               nullif(trim(phone), '')      as "phone",
               nullif(trim(source), '')     as "source",
               nullif(trim(description), '') as "description",
               coalesce(nullif(sales_rep_id, ''), nullif(owner, '')) as "ownerRepId",
               date_created                 as "dateCreated"
        from lead
        order by id
      `),
    readOpportunities: () =>
      rows<LastmileOpportunity>(`
        select id,
               coalesce(nullif(trim(opp_name), ''), nullif(trim(description), '')) as "name",
               nullif(trim(stage), '')       as "stage",
               amount::text                  as "amount",
               nullif(trim(quantity), '')    as "quantity",
               nullif(trim(product_type), '') as "productType",
               nullif(trim(brand), '')       as "brand",
               nullif(trim(closed), '')      as "closed",
               nullif(trim(won), '')         as "won",
               nullif(account_id, '')        as "accountId",
               coalesce(nullif(sales_rep_id, ''), null) as "ownerRepId",
               expected_close_date::text     as "expectedCloseDate",
               nullif(trim(description), '') as "description",
               date_created                  as "dateCreated"
        from opportunity
        order by id
      `),
    readOpportunityItems: () =>
      rows<LastmileOpportunityItem>(`
        select t.entity_id                       as "opportunityId",
               (it.ordinality - 1)::int          as "index",
               nullif(trim(it.value ->> 'brand'), '')    as "brand",
               nullif(trim(it.value ->> 'quantity'), '') as "quantity",
               nullif(trim(it.value ->> 'amount'), '')   as "amount"
        from task t
        cross join lateral jsonb_array_elements(t.entity_data -> 'items')
          with ordinality as it(value, ordinality)
        where t.entity_type = 'opportunity'
          and t.entity_id is not null
          and t.entity_data ? 'items'
          and jsonb_typeof(t.entity_data -> 'items') = 'array'
        order by t.entity_id, it.ordinality
      `),
    readCrmComments: () =>
      rows<LastmileCrmComment>(`
        select tc.id,
               t.entity_type as "entityType",
               t.entity_id   as "entityId",
               nullif(trim(tc.content), '') as "content",
               coalesce(tc.is_deleted, false) as "isDeleted",
               tc.created_at as "createdAt"
        from task_comment tc
        join task t on t.id = tc.task_id
        where t.entity_type in ('lead', 'opportunity')
          and t.entity_id is not null
        order by tc.id
      `),
    readCrmAttachments: () =>
      rows<LastmileCrmAttachment>(`
        select ta.id,
               t.entity_type as "entityType",
               t.entity_id   as "entityId",
               nullif(trim(ta.filename), '')  as "filename",
               nullif(trim(ta.file_path), '') as "filePath",
               nullif(trim(ta.file_type), '') as "fileType",
               nullif(trim(ta.bucket_name), '') as "bucketName"
        from task_attachment ta
        join task t on t.id = ta.task_id
        where t.entity_type in ('lead', 'opportunity')
          and t.entity_id is not null
        order by ta.id
      `),
    readCustomerNotes: () =>
      rows<LastmileCustomerNote>(`
        with account_names as (
          select lower(trim(name)) as norm_name, min(id) as account_id, count(*) as n
          from account
          where nullif(trim(name), '') is not null
          group by lower(trim(name))
        )
        select n.id,
               nullif(trim(n.note_text), '') as "noteText",
               c.id   as "customerId",
               nullif(trim(c.name), '') as "customerName",
               case when an.n = 1 then an.account_id else null end as "matchedAccountId",
               n.date_created as "dateCreated"
        from note n
        join customer c on c.id = n.owner_id
        left join account_names an on an.norm_name = lower(trim(c.name))
        order by n.id
      `),
    close: () => pool.end(),
  };
}
