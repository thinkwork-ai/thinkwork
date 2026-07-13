/**
 * Real DynamoDB adapter for the capability-broker session store (THINK-280 U3).
 *
 * Translates the structured {@link DynamoCondition} predicates emitted by
 * sessions.ts into DynamoDB ConditionExpressions and marshals plain-JS items
 * with a tiny hand-rolled marshaller (only S/N/BOOL/NULL are used — nested
 * snapshots are already serialized to JSON strings by the session store, so no
 * @aws-sdk/util-dynamodb dependency is needed).
 *
 * ConditionExpressions produced:
 *   - createSession:        attribute_not_exists(#pk)
 *   - consumeSequence:      #nextSequence = :v0 AND #cancelled = :v1 AND #status = :v2
 *   - recordNonce:          attribute_not_exists(#sk)
 *   - requestCancellation:  attribute_exists(#pk)
 *   - closeSession:         attribute_exists(#pk)
 *
 * A ConditionalCheckFailedException is caught and reported as a typed
 * `{ ok: false, conditionFailed: true }` — never rethrown — so the pure store
 * branches on replay/race exactly as the in-memory fake does.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";

import type {
  DynamoCondition,
  DynamoPort,
  DynamoPutInput,
  DynamoUpdateInput,
  DynamoWriteResult,
} from "./sessions.js";

function marshalValue(value: unknown): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  switch (typeof value) {
    case "string":
      return { S: value };
    case "number":
      return { N: String(value) };
    case "boolean":
      return { BOOL: value };
    default:
      // Session items only carry scalars + JSON-stringified snapshots; anything
      // else is a programming error, stored as its JSON string to stay safe.
      return { S: JSON.stringify(value) };
  }
}

function marshalItem(
  item: Record<string, unknown>,
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined) continue;
    out[k] = marshalValue(v);
  }
  return out;
}

function unmarshalValue(value: AttributeValue): unknown {
  if (value.S !== undefined) return value.S;
  if (value.N !== undefined) return Number(value.N);
  if (value.BOOL !== undefined) return value.BOOL;
  if (value.NULL) return null;
  return undefined;
}

function unmarshalItem(
  item: Record<string, AttributeValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    out[k] = unmarshalValue(v);
  }
  return out;
}

interface CompiledCondition {
  expression: string;
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
}

/** Compile a structured condition, appending onto shared name/value maps. */
function compileCondition(
  cond: DynamoCondition,
  ctx: {
    names: Record<string, string>;
    values: Record<string, AttributeValue>;
    n: number;
  },
): string {
  const nameRef = (attr: string): string => {
    const ref = `#${attr}`;
    ctx.names[ref] = attr;
    return ref;
  };
  const valueRef = (value: string | number | boolean): string => {
    const ref = `:v${ctx.n++}`;
    ctx.values[ref] = marshalValue(value);
    return ref;
  };
  switch (cond.kind) {
    case "attribute_not_exists":
      return `attribute_not_exists(${nameRef(cond.attribute)})`;
    case "attribute_exists":
      return `attribute_exists(${nameRef(cond.attribute)})`;
    case "equals":
      return `${nameRef(cond.attribute)} = ${valueRef(cond.value)}`;
    case "greater_than":
      return `${nameRef(cond.attribute)} > ${valueRef(cond.value)}`;
    case "and":
      return cond.conditions
        .map((c) => `(${compileCondition(c, ctx)})`)
        .join(" AND ");
  }
}

function buildCondition(
  cond: DynamoCondition | undefined,
): CompiledCondition | null {
  if (!cond) return null;
  const ctx = { names: {}, values: {}, n: 0 };
  const expression = compileCondition(cond, ctx);
  return { expression, names: ctx.names, values: ctx.values };
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

/** Build a {@link DynamoPort} bound to a DynamoDB client + table. */
export function createDynamoPort(
  client: DynamoDBClient,
  table: string,
): DynamoPort {
  return {
    async put(input: DynamoPutInput): Promise<DynamoWriteResult> {
      const compiled = buildCondition(input.condition);
      try {
        await client.send(
          new PutItemCommand({
            TableName: table,
            Item: marshalItem(input.item),
            ...(compiled
              ? {
                  ConditionExpression: compiled.expression,
                  ExpressionAttributeNames: compiled.names,
                  ...(Object.keys(compiled.values).length > 0
                    ? { ExpressionAttributeValues: compiled.values }
                    : {}),
                }
              : {}),
          }),
        );
        return { ok: true };
      } catch (err) {
        if (isConditionalCheckFailed(err)) {
          return { ok: false, conditionFailed: true };
        }
        throw err;
      }
    },
    async get(key) {
      const res = await client.send(
        new GetItemCommand({
          TableName: table,
          Key: marshalItem(key),
        }),
      );
      return res.Item ? unmarshalItem(res.Item) : null;
    },
    async update(input: DynamoUpdateInput): Promise<DynamoWriteResult> {
      const setEntries = Object.entries(input.set);
      const names: Record<string, string> = {};
      const values: Record<string, AttributeValue> = {};
      const setClauses = setEntries.map(([attr, value], i) => {
        const nRef = `#s${i}`;
        const vRef = `:s${i}`;
        names[nRef] = attr;
        values[vRef] = marshalValue(value);
        return `${nRef} = ${vRef}`;
      });
      const compiled = buildCondition(input.condition);
      if (compiled) {
        Object.assign(names, compiled.names);
        Object.assign(values, compiled.values);
      }
      try {
        const res = await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: marshalItem(input.key),
            UpdateExpression: `SET ${setClauses.join(", ")}`,
            ExpressionAttributeNames: names,
            ...(Object.keys(values).length > 0
              ? { ExpressionAttributeValues: values }
              : {}),
            ...(compiled ? { ConditionExpression: compiled.expression } : {}),
            ...(input.returnUpdated ? { ReturnValues: "ALL_NEW" } : {}),
          }),
        );
        return {
          ok: true,
          item: res.Attributes ? unmarshalItem(res.Attributes) : undefined,
        };
      } catch (err) {
        if (isConditionalCheckFailed(err)) {
          return { ok: false, conditionFailed: true };
        }
        throw err;
      }
    },
    async delete(key) {
      await client.send(
        new DeleteItemCommand({
          TableName: table,
          Key: marshalItem(key),
        }),
      );
    },
  };
}

export { DynamoDBClient };
