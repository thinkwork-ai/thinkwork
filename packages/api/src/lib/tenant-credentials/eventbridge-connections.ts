/**
 * Placeholder boundary for EventBridge Connection lifecycle.
 *
 * Native Step Functions HTTP Tasks require EventBridge Connections for
 * authentication. U1 stores the derived ARN; U3 decides whether creation
 * happens at credential save time or lazily during routine publish.
 */

export interface TenantCredentialConnectionResult {
  connectionArn: string | null;
  status: "not_applicable" | "pending";
}

export async function ensureTenantCredentialConnection(): Promise<TenantCredentialConnectionResult> {
  return { connectionArn: null, status: "not_applicable" };
}
