export interface CliAuthOption {
  key: string;
  label: string;
  clientId: string;
  identityProvider?: string;
  prompt?: string;
}

interface PublicAuthOptions {
  password?: { enabled?: boolean; clientId?: string };
  oauthOptions?: unknown[];
}

/**
 * Load only route-bound Cognito options published for the CLI family. An
 * unavailable or malformed catalog fails closed instead of falling back to a
 * shared app client that could erase provider and tenant provenance.
 */
export async function fetchCliAuthOptions(input: {
  apiBaseUrl: string;
  host?: string;
  fetchImpl?: typeof fetch;
}): Promise<CliAuthOption[]> {
  const url = new URL(
    `${input.apiBaseUrl.replace(/\/+$/, "")}/api/auth/options`,
  );
  url.searchParams.set("platform", "cli");
  if (input.host) url.searchParams.set("host", input.host);

  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Login catalog request failed (HTTP ${response.status}).`);
  }

  const raw = (await response.json()) as PublicAuthOptions;
  const result: CliAuthOption[] = [];
  const passwordClientId = cleanString(raw.password?.clientId);
  if (raw.password?.enabled === true && passwordClientId) {
    result.push({
      key: "local",
      label: "Email and password",
      clientId: passwordClientId,
    });
  }

  for (const entry of Array.isArray(raw.oauthOptions) ? raw.oauthOptions : []) {
    const option = parseOAuthOption(entry);
    if (option) result.push(option);
  }
  return result;
}

function parseOAuthOption(raw: unknown): CliAuthOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const route = record.route;
  if (!route || typeof route !== "object" || Array.isArray(route)) return null;
  const routeRecord = route as Record<string, unknown>;
  const key = cleanString(record.key);
  const label = cleanString(record.label);
  const clientId = cleanString(routeRecord.clientId);
  const identityProvider = cleanString(routeRecord.identityProvider);
  const prompt = cleanString(routeRecord.prompt);
  if (
    !key ||
    !label ||
    !clientId ||
    !identityProvider ||
    record.providerSpecific !== true ||
    routeRecord.type !== "cognitoHostedUi"
  ) {
    return null;
  }
  return {
    key,
    label,
    clientId,
    identityProvider,
    ...(prompt ? { prompt } : {}),
  };
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
