/**
 * Admin "new routine" surface (Plan 2026-05-01-007 §U13).
 *
 * v1 ships as a thin form: operator enters name + description, and the
 * server-side authoring MVP attempts to produce real recipe-backed ASL
 * through `createRoutine`. Unsupported intents are rejected before any
 * Step Functions resources are created.
 *
 * Plan §"Files" calls for a full RoutineChatBuilder admin chrome
 * (sharing the mobile ROUTINE_BUILDER_PROMPT). Mobile's chat session
 * infrastructure (createSession / sendToSession) is currently stubbed
 * pending GraphQL migration (per Phase C U10's caveat); this form is the
 * non-chat authoring bridge until that lands.
 */

import { useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { ArrowLeft } from "lucide-react";
import { CreateRoutineMutation } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/routines/new",
)({
  component: NewRoutinePage,
});

function NewRoutinePage() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, executeCreate] = useMutation(CreateRoutineMutation);

  useBreadcrumbs([
    { label: "Routines", href: "/automations/routines" },
    { label: "New" },
  ]);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !tenantId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await executeCreate({
        input: {
          tenantId,
          name: name.trim(),
          description: description.trim(),
        },
      });
      const routineId = result.data?.createRoutine?.id;
      if (!routineId) {
        const errMsg =
          result.error?.message ?? "Failed to create routine (no id returned).";
        throw new Error(errMsg);
      }
      navigate({
        to: "/automations/routines/$routineId",
        params: { routineId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [
    canSubmit,
    tenantId,
    submitting,
    name,
    description,
    executeCreate,
    navigate,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: "/automations/routines" })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title="New routine"
          description="Describe what you want to automate. The chat builder will iterate the steps with you."
        />
      </div>

      <Card className="max-w-2xl">
        <CardContent className="space-y-4 py-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Triage overnight email"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">What should it do?</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Pull overnight email from the inbox, classify each into urgent/normal, post a digest to #ops, and require approval before sending replies."
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/automations/routines" })}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? "Creating…" : "Create routine"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
