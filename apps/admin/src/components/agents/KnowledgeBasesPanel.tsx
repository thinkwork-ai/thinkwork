import { useState, useEffect } from "react";
import { useQuery, useMutation } from "urql";
import { Plus, ChevronRight, Loader2, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTenant } from "@/context/TenantContext";
import {
  KnowledgeBasesListQuery,
  SetAgentKnowledgeBasesMutation,
} from "@/lib/graphql-queries";

interface AgentKb {
  knowledgeBaseId: string;
  enabled: boolean;
  knowledgeBase?: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
  } | null;
}

interface Props {
  agentId: string;
  knowledgeBases: readonly AgentKb[];
  onSave: () => void;
}

export function KnowledgeBasesPanel({ agentId, knowledgeBases, onSave }: Props) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<AgentKb[]>([...knowledgeBases]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [, setAgentKbs] = useMutation(SetAgentKnowledgeBasesMutation);

  // Fetch all KBs for the add dialog
  const [allKbsResult] = useQuery({
    query: KnowledgeBasesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !addDialogOpen,
  });

  const allKbs = ((allKbsResult.data as any)?.knowledgeBases ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
  }>;

  const assignedIds = new Set(items.map((i) => i.knowledgeBaseId));
  const availableKbs = allKbs.filter((kb) => !assignedIds.has(kb.id) && kb.status === "active");

  const handleAdd = async (kbId: string) => {
    setAddingId(kbId);
    const kb = allKbs.find((k) => k.id === kbId);
    const newItems = [...items, { knowledgeBaseId: kbId, enabled: true, knowledgeBase: kb ?? null }];
    try {
      const res = await setAgentKbs({
        agentId,
        knowledgeBases: newItems.map((i) => ({
          knowledgeBaseId: i.knowledgeBaseId,
          enabled: i.enabled,
        })),
      });
      if (!res.error) {
        setItems(newItems);
        setAddDialogOpen(false);
        onSave();
      }
    } catch (err) {
      console.error("Failed to add KB:", err);
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (kbId: string) => {
    setRemoving(true);
    const newItems = items.filter((i) => i.knowledgeBaseId !== kbId);
    try {
      const res = await setAgentKbs({
        agentId,
        knowledgeBases: newItems.map((i) => ({
          knowledgeBaseId: i.knowledgeBaseId,
          enabled: i.enabled,
        })),
      });
      if (!res.error) {
        setItems(newItems);
        setConfirmRemove(null);
        onSave();
      }
    } catch (err) {
      console.error("Failed to remove KB:", err);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Knowledge Bases</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add KB
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 p-0 pb-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground px-4 py-3">
              No knowledge bases assigned.
            </p>
          )}
          {items.map((item) => (
            <div
              key={item.knowledgeBaseId}
              className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium">
                    {item.knowledgeBase?.name ?? item.knowledgeBaseId}
                  </p>
                  {item.knowledgeBase?.status === "active"
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                  }
                </div>
                <div className="flex items-center gap-1.5">
                  {item.knowledgeBase?.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {item.knowledgeBase.description}
                    </p>
                  )}
                  {confirmRemove === item.knowledgeBaseId ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => handleRemove(item.knowledgeBaseId)}
                        disabled={removing}
                      >
                        {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remove"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setConfirmRemove(null)}
                        disabled={removing}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 mb-1 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmRemove(item.knowledgeBaseId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add KB dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Knowledge Base</DialogTitle>
            <DialogDescription>
              Assign a knowledge base to this agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-[400px] overflow-y-auto -mx-2">
            {allKbsResult.fetching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : availableKbs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No available knowledge bases. Create one first.
              </p>
            ) : (
              availableKbs.map((kb) => (
                <button
                  key={kb.id}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent rounded-md transition-colors disabled:opacity-50"
                  onClick={() => handleAdd(kb.id)}
                  disabled={addingId === kb.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{kb.name}</p>
                    {kb.description && (
                      <p className="text-xs text-muted-foreground truncate">{kb.description}</p>
                    )}
                  </div>
                  {addingId === kb.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 ml-3" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-3" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
