import { useQuery, useMutation } from "urql";
import { MeQuery, UserQuery, UpdateUserMutation, UpdateUserProfileMutation } from "@/lib/graphql-queries";

export function useMe() {
  return useQuery({ query: MeQuery });
}
export function useUser(id: string | undefined) {
  return useQuery({ query: UserQuery, variables: { id: id! }, pause: !id });
}
export function useUpdateUser() { return useMutation(UpdateUserMutation); }
export function useUpdateUserProfile() { return useMutation(UpdateUserProfileMutation); }
