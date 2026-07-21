export function agentCoreOAuthSessionUri(
  query: Record<string, string | undefined>,
): string | undefined {
  // AgentCore's browser redirect uses `session_id`; the SDK/API calls the
  // same value `sessionUri`. Keep the aliases for existing clients.
  return query.session_id ?? query.sessionUri ?? query.session_uri;
}

export function agentCoreOAuthPrincipalMatches(input: {
  stateUserId: string;
  stateTenantId: string;
  principalUserId: string;
  principalTenantId: string;
}): boolean {
  return (
    input.stateUserId === input.principalUserId &&
    input.stateTenantId === input.principalTenantId
  );
}
