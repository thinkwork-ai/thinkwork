import { useQuery, useMutation } from "urql";
import {
  MemoryRecordsQuery,
  DeleteMemoryRecordMutation,
  UpdateMemoryRecordMutation,
} from "@/lib/graphql-queries";

export function useMemoryRecords(userId: string | undefined, namespace: string | undefined) {
  return useQuery({
    query: MemoryRecordsQuery,
    variables: { userId: userId!, namespace: namespace! },
    pause: !userId || !namespace,
  });
}

export function useDeleteMemoryRecord() {
  return useMutation(DeleteMemoryRecordMutation);
}

export function useUpdateMemoryRecord() {
  return useMutation(UpdateMemoryRecordMutation);
}
