import { useQuery, useMutation } from "urql";
import {
  MemoryRecordsQuery,
  DeleteMemoryRecordMutation,
  UpdateMemoryRecordMutation,
} from "@/lib/graphql-queries";

export function useMemoryRecords(assistantId: string | undefined, namespace: string | undefined) {
  return useQuery({
    query: MemoryRecordsQuery,
    variables: { assistantId: assistantId!, namespace: namespace! },
    pause: !assistantId || !namespace,
  });
}

export function useDeleteMemoryRecord() {
  return useMutation(DeleteMemoryRecordMutation);
}

export function useUpdateMemoryRecord() {
  return useMutation(UpdateMemoryRecordMutation);
}
