import { useQuery, useMutation } from "urql";
import { MeQuery, UserQuery, UpdateUserMutation, UpdateUserProfileMutation } from "@/lib/graphql-queries";
import { useAuth } from "@/lib/auth-context";

export function useMe() {
  // Pause until the auth token is cached in the GraphQL client. Without
  // this, useMe() can fire on cold start before setAuthToken() runs,
  // fall through to the x-api-key path which leaves principalId null
  // server-side, and cache a null me — stranding anything downstream
  // that depends on user.tenantId (MCP Servers, Connectors, etc.) on
  // a skeleton forever.
  const { isAuthenticated } = useAuth();
  return useQuery({ query: MeQuery, pause: !isAuthenticated });
}
export function useUser(id: string | undefined) {
  return useQuery({ query: UserQuery, variables: { id: id! }, pause: !id });
}
export function useUpdateUser() { return useMutation(UpdateUserMutation); }
export function useUpdateUserProfile() { return useMutation(UpdateUserProfileMutation); }
