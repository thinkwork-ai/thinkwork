import { useQuery, useMutation } from "urql";
import {
  TenantQuery, TenantBySlugQuery, TenantMembersQuery,
  UpdateTenantMutation, UpdateTenantSettingsMutation,
} from "@/lib/graphql-queries";

export function useTenant(id: string | undefined) {
  return useQuery({ query: TenantQuery, variables: { id: id! }, pause: !id });
}
export function useTenantBySlug(slug: string | undefined) {
  return useQuery({ query: TenantBySlugQuery, variables: { slug: slug! }, pause: !slug });
}
export function useTenantMembers(tenantId: string | undefined) {
  return useQuery({ query: TenantMembersQuery, variables: { tenantId: tenantId! }, pause: !tenantId });
}
export function useUpdateTenant() { return useMutation(UpdateTenantMutation); }
export function useUpdateTenantSettings() { return useMutation(UpdateTenantSettingsMutation); }
