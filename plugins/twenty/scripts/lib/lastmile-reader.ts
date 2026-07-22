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

export interface LastmileDispatchCustomer {
  id: string;
  name: string | null;
  /** dispatch customer.external_id — the P21 account key ("P21:12345"). */
  p21Code: string | null;
  ownerRepId: string | null;
  /** An `account` row already carries this exact (case-folded) name — the
   * account-sourced company covers it, so the dispatch source skips it. */
  hasAccountNameMatch: boolean;
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

/**
 * The `task` table is LastMile's live CRM. Everything a rep sees hangs off it:
 * `status_id` (the real pipeline status — the `opportunity.stage` column is
 * stale and disagrees for 889 of 950 rows), `assignee_id` (the owning rep),
 * `organization_id` (the branch, e.g. "GWO 300"), and `entity_data` (name,
 * description, account, and the product `items` array). Task rows only exist
 * from 2025-07 onward; older opportunity/lead rows are legacy and out of scope.
 */
export interface LastmileCrmTask {
  taskId: string;
  entityType: "lead" | "opportunity";
  /** opportunity/lead row id — the stable identity for the Twenty record. */
  entityId: string;
  title: string | null;
  description: string | null;
  /** Present on opportunity tasks only; leads pre-date an account. */
  accountId: string | null;
  /** Company name typed on a lead before an account exists. */
  leadCompanyName: string | null;
  statusName: string | null;
  organizationId: string | null;
  /** Owning rep, resolved from the task's assignee user. */
  assigneeRepId: string | null;
  dueDate: Date | null;
  createdAt: Date | null;
  /** Product lines: [{ brand, quantity, amount }, ...] */
  items: Array<{
    brand?: string | null;
    quantity?: string | number | null;
    amount?: string | number | null;
  }> | null;
}

export interface LastmileOrganization {
  id: string;
  name: string | null;
  /** Short code shown in the LastMile UI, e.g. "GWO 300". */
  abbv: string | null;
  archived: boolean;
}

export interface LastmileCrmComment {
  id: string;
  entityType: "lead" | "opportunity";
  entityId: string;
  content: string | null;
  isDeleted: boolean;
  /** Authored-at time. Carried onto the Twenty note so the activity feed
   * reflects when the rep actually wrote it, not when the import ran. */
  createdAt: Date | null;
  authorName: string | null;
}

/**
 * A single status-change event from LastMile's `task_activity` log — the row
 * behind "Dean Kittel changed status to 10-Prospect" in the task activity feed.
 * The pipeline transition is reconstructed onto the Twenty opportunity as a
 * dated Note so the activity timeline reads in true order. `activity_data`
 * carries human-readable stage names (`new_status_name` in every prod row; the
 * camelCase `newStatusName` variant is coalesced defensively). `created_at` is
 * the real transition time; `user_id` resolves to the rep who moved it.
 */
export interface LastmileTaskStatusChange {
  id: string;
  entityType: "lead" | "opportunity";
  entityId: string;
  oldStatusName: string | null;
  newStatusName: string | null;
  createdAt: Date | null;
  authorName: string | null;
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

/** TEI's operating company in the dispatch database (the others are demo
 * shells) — dispatch-side reads scope to it; the CRM tables are single-tenant
 * and stay unscoped. */
const TEI_DISPATCH_COMPANY_ID = "co_y15610tsjbkqz5cqoic8gjla";

export interface LastmileReader {
  readReps(): Promise<LastmileRep[]>;
  readAccounts(): Promise<LastmileAccount[]>;
  /** Dispatch customers with an order in the last `days` days (the ThinkWork
   * twin's seed cohort rule) — the "real customers" band for the CRM. */
  readOrderCohortCustomers(days: number): Promise<LastmileDispatchCustomer[]>;
  readContacts(): Promise<LastmileContact[]>;
  readLeads(): Promise<LastmileLead[]>;
  readOpportunities(): Promise<LastmileOpportunity[]>;
  readCrmTasks(): Promise<LastmileCrmTask[]>;
  readOrganizations(): Promise<LastmileOrganization[]>;
  readOpportunityItems(): Promise<LastmileOpportunityItem[]>;
  readCrmComments(): Promise<LastmileCrmComment[]>;
  readTaskStatusChanges(): Promise<LastmileTaskStatusChange[]>;
  readCrmAttachments(): Promise<LastmileCrmAttachment[]>;
  readCustomerNotes(): Promise<LastmileCustomerNote[]>;
  close(): Promise<void>;
}

/**
 * The accounts TEI actually sells to: those referenced by a CRM task (lead or
 * opportunity). Companies and contacts are both scoped to this set — LastMile
 * carries 3,403 accounts and 29,966 contacts, but only 805 accounts have an
 * opportunity, and 443 contacts sit on them. Everything else is old data that
 * stays in LastMile (Eric, 2026-07-10).
 */
const OPPORTUNITY_ACCOUNTS_CTE = `
  opportunity_accounts as (
    select distinct nullif(trim(t.entity_data ->> 'account_id'), '') as account_id
    from task t
    where t.entity_type in ('lead', 'opportunity')
      and nullif(trim(t.entity_data ->> 'account_id'), '') is not null
  )
`;

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
        with ${OPPORTUNITY_ACCOUNTS_CTE}
        select id, nullif(trim(name), '') as "name", nullif(owner, '') as "ownerRepId"
        from account
        where id in (select account_id from opportunity_accounts)
        order by id
      `),
    readOrderCohortCustomers: (days: number) => {
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error(`cohort days must be an integer 1..365, got ${days}`);
      }
      return rows<LastmileDispatchCustomer>(`
        with cohort as (
          select distinct o.customer_id as id
          from order_header o
          where o.company_id = '${TEI_DISPATCH_COMPANY_ID}'
            and o.archived is not true
            and o.order_date > now() - interval '${days} days'
            and o.customer_id is not null
        )
        select c.id,
               nullif(trim(c.name), '') as "name",
               nullif(trim(c.external_id), '') as "p21Code",
               (
                 select s.sales_rep_id from ship_to s
                 where s.customer_id = c.id and s.sales_rep_id is not null
                 group by s.sales_rep_id order by count(*) desc, s.sales_rep_id
                 limit 1
               ) as "ownerRepId",
               exists (
                 select 1 from account a
                 where lower(trim(a.name)) = lower(trim(c.name))
               ) as "hasAccountNameMatch"
        from customer c
        join cohort on cohort.id = c.id
        where c.archived is not true
        order by c.id
      `);
    },
    readContacts: () =>
      rows<LastmileContact>(`
        with ${OPPORTUNITY_ACCOUNTS_CTE}
        select id,
               nullif(account_id, '')      as "accountId",
               nullif(trim(first_name), '') as "firstName",
               nullif(trim(last_name), '')  as "lastName",
               nullif(trim(email_address), '') as "email",
               nullif(trim(phone), '')     as "phone",
               nullif(trim(phone_cellular), '') as "phoneCellular",
               nullif(trim(title), '')     as "title"
        from contact
        where account_id in (select account_id from opportunity_accounts)
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
    readCrmTasks: () =>
      rows<LastmileCrmTask>(`
        select t.id                              as "taskId",
               t.entity_type                     as "entityType",
               t.entity_id                       as "entityId",
               coalesce(
                 nullif(trim(t.entity_data ->> 'opp_name'), ''),
                 nullif(trim(t.title), '')
               )                                 as "title",
               nullif(trim(t.entity_data ->> 'description'), '') as "description",
               nullif(trim(t.entity_data ->> 'account_id'), '')  as "accountId",
               nullif(trim(t.entity_data ->> 'company'), '')     as "leadCompanyName",
               nullif(trim(s.name), '')          as "statusName",
               nullif(t.organization_id, '')     as "organizationId",
               nullif(u.sales_rep_id, '')        as "assigneeRepId",
               t.due_date                        as "dueDate",
               t.created_at                      as "createdAt",
               case
                 when jsonb_typeof(t.entity_data -> 'items') = 'array'
                 then t.entity_data -> 'items'
                 else null
               end                               as "items"
        from task t
        left join status s on s.id = t.status_id
        left join users u  on u.id = t.assignee_id
        where t.entity_type in ('lead', 'opportunity')
          and t.entity_id is not null
        order by t.entity_type, t.entity_id
      `),
    readOrganizations: () =>
      rows<LastmileOrganization>(`
        select id,
               nullif(trim(name), '') as "name",
               nullif(trim(abbv), '') as "abbv",
               coalesce(archived, false) as "archived"
        from organization
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
               tc.created_at as "createdAt",
               nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '') as "authorName"
        from task_comment tc
        join task t on t.id = tc.task_id
        left join users u on u.id = tc.user_id
        where t.entity_type in ('lead', 'opportunity')
          and t.entity_id is not null
        order by tc.id
      `),
    readTaskStatusChanges: () =>
      rows<LastmileTaskStatusChange>(`
        select ta.id,
               t.entity_type as "entityType",
               t.entity_id   as "entityId",
               coalesce(
                 nullif(trim(ta.activity_data ->> 'old_status_name'), ''),
                 nullif(trim(ta.activity_data ->> 'oldStatusName'), '')
               ) as "oldStatusName",
               coalesce(
                 nullif(trim(ta.activity_data ->> 'new_status_name'), ''),
                 nullif(trim(ta.activity_data ->> 'newStatusName'), '')
               ) as "newStatusName",
               ta.created_at as "createdAt",
               nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '') as "authorName"
        from task_activity ta
        join task t on t.id = ta.task_id
        left join users u on u.id = ta.user_id
        where t.entity_type in ('lead', 'opportunity')
          and t.entity_id is not null
          and ta.activity_type in ('status_changed', 'status_change')
        order by ta.id
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
        with ${OPPORTUNITY_ACCOUNTS_CTE},
        account_names as (
          -- Only migrated accounts can host a note.
          select lower(trim(name)) as norm_name, min(id) as account_id, count(*) as n
          from account
          where nullif(trim(name), '') is not null
            and id in (select account_id from opportunity_accounts)
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
