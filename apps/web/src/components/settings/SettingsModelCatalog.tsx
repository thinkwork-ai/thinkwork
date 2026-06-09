import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { CloudDownload, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@thinkwork/ui";
import type {
  BedrockModelImportCandidate,
  TenantModelCatalogEntry,
} from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsBedrockModelImportCandidatesQuery,
  SettingsImportTenantBedrockModelsMutation,
  SettingsTenantModelCatalogQuery,
  SettingsUpdateTenantModelCatalogEntryMutation,
} from "@/lib/settings-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import {
  formatModelCostLine,
  formatPerMillionCost,
} from "@/components/settings/UserModelsSection";

type CatalogRow = TenantModelCatalogEntry;
type CandidateRow = BedrockModelImportCandidate;

const RESOLVED_PRICING = "resolved";
const CATALOG_PROVIDER_LABEL = "Bedrock";
const FIT_COLUMN_META = {
  meta: {
    headClassName: "whitespace-nowrap",
    cellClassName: "whitespace-nowrap",
  },
};
const MODEL_ID_COLUMN_META = {
  meta: { headClassName: "px-4", cellClassName: "min-w-0" },
};
const IMPORT_NAME_COLUMN_META = {
  meta: { headClassName: "px-4", cellClassName: "max-w-0" },
};
const IMPORT_FIT_COLUMN_META = {
  meta: {
    headClassName: "w-px whitespace-nowrap",
    cellClassName: "w-px whitespace-nowrap",
  },
};
const NUMERIC_COLUMN_META = {
  meta: {
    headClassName: "whitespace-nowrap text-right",
    cellClassName: "whitespace-nowrap text-right",
  },
};

function pricingBadgeVariant(status: string) {
  switch (status) {
    case RESOLVED_PRICING:
      return "default" as const;
    case "missing":
      return "secondary" as const;
    case "ambiguous":
    case "error":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function canEnableModel(
  row: Pick<
    CatalogRow | CandidateRow,
    "pricingStatus" | "inputCostPerMillion" | "outputCostPerMillion"
  >,
) {
  return (
    row.pricingStatus === RESOLVED_PRICING &&
    row.inputCostPerMillion != null &&
    row.outputCostPerMillion != null
  );
}

function catalogCapabilities(row: CatalogRow) {
  return [
    row.supportsVision ? "Vision" : null,
    row.supportsTools ? "Tools" : null,
    row.contextWindow ? `${row.contextWindow.toLocaleString()} ctx` : null,
    row.maxOutputTokens
      ? `${row.maxOutputTokens.toLocaleString()} max out`
      : null,
  ].filter((value): value is string => Boolean(value));
}

function pricingText(
  row: Pick<
    CatalogRow | CandidateRow,
    "inputCostPerMillion" | "outputCostPerMillion"
  >,
) {
  return formatModelCostLine({
    inputCostPerMillion: row.inputCostPerMillion,
    outputCostPerMillion: row.outputCostPerMillion,
  });
}

function priceInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function modelUpdateErrorMessage(error: {
  graphQLErrors?: Array<{ message?: string }>;
  message?: string;
}) {
  const message = error.graphQLErrors?.[0]?.message ?? error.message ?? "";
  if (
    message.includes("inputCostPerMillion") ||
    message.includes("outputCostPerMillion") ||
    message.includes("UpdateTenantModelCatalogEntryInput")
  ) {
    return "Manual pricing requires the latest API deployment. The local UI is newer than the deployed GraphQL schema.";
  }
  return message || "Unknown update error.";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function modelMatchesSearch(row: CatalogRow, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    row.displayName,
    row.canonicalDisplayName,
    row.modelId,
    CATALOG_PROVIDER_LABEL,
    row.provider,
    row.pricingStatus,
  ].some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(q),
  );
}

export function SettingsModelCatalog() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<CatalogRow | null>(null);
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  const [catalogResult, refetchCatalog] = useQuery({
    query: SettingsTenantModelCatalogQuery,
    variables: { tenantId: tenantId ?? "", includeDisabled: true },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, updateCatalogEntry] = useMutation(
    SettingsUpdateTenantModelCatalogEntryMutation,
  );

  const rows = useMemo(
    () =>
      (catalogResult.data?.tenantModelCatalog ?? [])
        .filter((row) => modelMatchesSearch(row, search))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [catalogResult.data?.tenantModelCatalog, search],
  );

  async function handleEnabledChange(row: CatalogRow, enabled: boolean) {
    if (!tenantId || !canEnableModel(row)) return;
    setSavingModelId(row.modelId);
    const result = await updateCatalogEntry({
      input: { tenantId, modelId: row.modelId, enabled },
    });
    setSavingModelId(null);

    if (result.error) {
      toast.error("Could not update model", {
        description:
          result.error.graphQLErrors[0]?.message ?? result.error.message,
      });
      return;
    }

    setEditingRow((current) =>
      current?.modelId === row.modelId ? { ...current, enabled } : current,
    );
    refetchCatalog({ requestPolicy: "network-only" });
    toast.success(enabled ? "Model enabled" : "Model disabled");
  }

  const columns = useMemo<ColumnDef<CatalogRow>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: "Name",
        size: 144,
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <div
            className="truncate font-medium text-foreground"
            title={row.original.displayName}
          >
            {row.original.displayName}
          </div>
        ),
      },
      {
        accessorKey: "provider",
        header: "Provider",
        size: 120,
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <Badge variant="secondary">{CATALOG_PROVIDER_LABEL}</Badge>
        ),
      },
      {
        accessorKey: "modelId",
        header: "Model ID",
        ...MODEL_ID_COLUMN_META,
        cell: ({ row }) => (
          <code
            className="block min-w-0 truncate text-xs text-muted-foreground"
            title={row.original.modelId}
          >
            {row.original.modelId}
          </code>
        ),
      },
      {
        accessorKey: "inputCostPerMillion",
        header: "Input",
        size: 86,
        ...NUMERIC_COLUMN_META,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatPerMillionCost(row.original.inputCostPerMillion)}
          </span>
        ),
      },
      {
        accessorKey: "outputCostPerMillion",
        header: "Output",
        size: 92,
        ...NUMERIC_COLUMN_META,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatPerMillionCost(row.original.outputCostPerMillion)}
          </span>
        ),
      },
    ],
    [],
  );

  if (catalogResult.error) {
    return (
      <SettingsTablePane
        title="Model Catalog"
        description="Configured Bedrock models available to this tenant."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refetchCatalog({ requestPolicy: "network-only" })}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        }
      >
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Could not load model catalog.
        </div>
      </SettingsTablePane>
    );
  }

  return (
    <SettingsTablePane
      title="Model Catalog"
      description="Configured Bedrock models available to this tenant."
      loading={catalogResult.fetching && !catalogResult.data}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setImportOpen(true)}
        >
          <CloudDownload className="h-4 w-4" />
          Import
        </Button>
      }
      toolbar={
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={setEditingRow}
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="w-full table-fixed"
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No tenant models configured.
          </div>
        }
      />
      <ImportModelsDialog
        open={importOpen}
        tenantId={tenantId ?? ""}
        onOpenChange={setImportOpen}
        onImported={() => refetchCatalog({ requestPolicy: "network-only" })}
      />
      <ModelDetailsDialog
        row={editingRow}
        tenantId={tenantId ?? ""}
        savingModelId={savingModelId}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null);
        }}
        onEnabledChange={handleEnabledChange}
        onSaved={() => refetchCatalog({ requestPolicy: "network-only" })}
      />
    </SettingsTablePane>
  );
}

function ImportModelsDialog({
  open,
  onOpenChange,
  tenantId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onImported: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [candidatesResult, refetchCandidates] = useQuery({
    query: SettingsBedrockModelImportCandidatesQuery,
    variables: { tenantId },
    pause: !open || !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [importState, importModels] = useMutation(
    SettingsImportTenantBedrockModelsMutation,
  );

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected({});
      setDisplayNames({});
    }
  }, [open]);

  const candidates = useMemo(
    () =>
      (candidatesResult.data?.bedrockModelImportCandidates ?? [])
        .filter((candidate) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          return [
            candidate.displayName,
            candidate.modelName,
            candidate.modelId,
            candidate.providerName,
            candidate.pricingStatus,
            candidate.lifecycleStatus,
          ].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(query),
          );
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [candidatesResult.data?.bedrockModelImportCandidates, search],
  );

  const selectedModels = useMemo(
    () =>
      (candidatesResult.data?.bedrockModelImportCandidates ?? []).filter(
        (candidate) => selected[candidate.modelId],
      ),
    [candidatesResult.data?.bedrockModelImportCandidates, selected],
  );

  function toggleSelected(candidate: CandidateRow, checked: boolean) {
    if (candidate.alreadyImported) return;
    setSelected((current) => ({ ...current, [candidate.modelId]: checked }));
    setDisplayNames((current) => ({
      ...current,
      [candidate.modelId]: current[candidate.modelId] ?? candidate.displayName,
    }));
  }

  async function submitImport() {
    if (!tenantId || selectedModels.length === 0) return;

    const result = await importModels({
      input: {
        tenantId,
        models: selectedModels.map((candidate) => ({
          modelId: candidate.modelId,
          displayName:
            displayNames[candidate.modelId]?.trim() || candidate.displayName,
          enabled: false,
        })),
      },
    });

    if (result.error) {
      toast.error("Could not import models", {
        description:
          result.error.graphQLErrors[0]?.message ?? result.error.message,
      });
      return;
    }

    toast.success(
      selectedModels.length === 1 ? "Model imported" : "Models imported",
    );
    onImported();
    onOpenChange(false);
  }

  const columns = useMemo<ColumnDef<CandidateRow>[]>(
    () => [
      {
        id: "selected",
        header: "",
        meta: {
          headClassName: "w-px whitespace-nowrap align-top",
          cellClassName: "w-px whitespace-nowrap align-top",
        },
        cell: ({ row }) => (
          <div className="flex min-h-16 items-start pt-3">
            <Checkbox
              aria-label={`Select ${row.original.displayName}`}
              checked={Boolean(selected[row.original.modelId])}
              disabled={row.original.alreadyImported}
              onCheckedChange={(checked) =>
                toggleSelected(row.original, checked === true)
              }
            />
          </div>
        ),
      },
      {
        accessorKey: "displayName",
        header: "Name",
        ...IMPORT_NAME_COLUMN_META,
        cell: ({ row }) => (
          <div className="flex min-h-16 min-w-0 flex-col justify-start gap-1 pb-3 pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="min-w-0 truncate font-medium"
                title={row.original.displayName}
              >
                {row.original.displayName}
              </span>
              {row.original.alreadyImported ? (
                <Badge variant="outline" className="shrink-0">
                  imported
                </Badge>
              ) : null}
            </div>
            <code
              className="block min-w-0 truncate text-xs text-muted-foreground"
              title={row.original.modelId}
            >
              {row.original.modelId}
            </code>
            {selected[row.original.modelId] ? (
              <Input
                aria-label={`Display name for ${row.original.displayName}`}
                value={
                  displayNames[row.original.modelId] ?? row.original.displayName
                }
                onChange={(event) =>
                  setDisplayNames((current) => ({
                    ...current,
                    [row.original.modelId]: event.target.value,
                  }))
                }
                className="h-8 min-w-0"
              />
            ) : null}
          </div>
        ),
      },
    ],
    [displayNames, selected],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,760px)] w-[min(94vw,1180px)] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import Bedrock models</DialogTitle>
          <DialogDescription>
            AWS catalog models and Price List token pricing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search AWS models..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={candidatesResult.fetching}
            onClick={() => refetchCandidates({ requestPolicy: "network-only" })}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {candidatesResult.error ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Could not load Bedrock models.
            </div>
          ) : candidatesResult.fetching && !candidatesResult.data ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading Bedrock models...
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={candidates}
              pageSize={0}
              allowHorizontalScroll={false}
              scrollable
              emptyState={
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No import candidates.
                </div>
              }
            />
          )}
        </div>
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {selectedModels.length} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selectedModels.length === 0 || importState.fetching}
                onClick={submitImport}
              >
                <CloudDownload className="h-4 w-4" />
                Import selected
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelDetailsDialog({
  row,
  tenantId,
  savingModelId,
  onOpenChange,
  onEnabledChange,
  onSaved,
}: {
  row: CatalogRow | null;
  tenantId: string;
  savingModelId: string | null;
  onOpenChange: (open: boolean) => void;
  onEnabledChange: (row: CatalogRow, enabled: boolean) => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [state, updateCatalogEntry] = useMutation(
    SettingsUpdateTenantModelCatalogEntryMutation,
  );

  useEffect(() => {
    setDisplayName(row?.displayName ?? "");
    setInputPrice(priceInputValue(row?.inputCostPerMillion));
    setOutputPrice(priceInputValue(row?.outputCostPerMillion));
    setSaveError(null);
  }, [row]);

  async function save() {
    if (!row || !tenantId) return;
    setSaveError(null);
    const inputPriceText = inputPrice.trim();
    const outputPriceText = outputPrice.trim();
    const priceInputChanged =
      inputPriceText !== priceInputValue(row.inputCostPerMillion) ||
      outputPriceText !== priceInputValue(row.outputCostPerMillion);
    const pricePatch: {
      inputCostPerMillion?: number;
      outputCostPerMillion?: number;
    } = {};

    if (priceInputChanged) {
      if (!inputPriceText || !outputPriceText) {
        setSaveError("Input and output pricing are required together.");
        toast.error("Enter both token prices", {
          description: "Input and output pricing are required together.",
        });
        return;
      }

      const parsedInputPrice = Number(inputPriceText);
      const parsedOutputPrice = Number(outputPriceText);
      if (
        !Number.isFinite(parsedInputPrice) ||
        !Number.isFinite(parsedOutputPrice) ||
        parsedInputPrice < 0 ||
        parsedOutputPrice < 0
      ) {
        setSaveError("Token prices must be non-negative numbers.");
        toast.error("Token prices must be non-negative numbers");
        return;
      }

      pricePatch.inputCostPerMillion = parsedInputPrice;
      pricePatch.outputCostPerMillion = parsedOutputPrice;
    }

    const result = await updateCatalogEntry({
      input: {
        tenantId,
        modelId: row.modelId,
        displayName: displayName.trim(),
        ...pricePatch,
      },
    });

    if (result.error) {
      const description = modelUpdateErrorMessage(result.error);
      setSaveError(description);
      toast.error("Could not update model", {
        description,
      });
      return;
    }

    toast.success("Model updated");
    onSaved();
    onOpenChange(false);
  }

  const canEnable = row ? canEnableModel(row) : false;
  const capabilities = row ? catalogCapabilities(row) : [];

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.displayName ?? "Model details"}</DialogTitle>
          <DialogDescription>{row?.modelId}</DialogDescription>
        </DialogHeader>
        {row ? (
          <div className="space-y-5">
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="model-display-name"
              >
                Display name
              </label>
              <Input
                id="model-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="model-input-price"
                >
                  Input price
                </label>
                <Input
                  id="model-input-price"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  type="number"
                  value={inputPrice}
                  onChange={(event) => setInputPrice(event.target.value)}
                  placeholder="USD per 1M input tokens"
                />
              </div>
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="model-output-price"
                >
                  Output price
                </label>
                <Input
                  id="model-output-price"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  type="number"
                  value={outputPrice}
                  onChange={(event) => setOutputPrice(event.target.value)}
                  placeholder="USD per 1M output tokens"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Enabled</div>
                <div className="text-xs text-muted-foreground">
                  {canEnable
                    ? "Available for this tenant."
                    : "Requires resolved input and output pricing."}
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Switch
                      aria-label={
                        canEnable
                          ? `${row.enabled ? "Disable" : "Enable"} ${row.displayName}`
                          : `Pricing unresolved for ${row.displayName}`
                      }
                      checked={row.enabled}
                      disabled={!canEnable || savingModelId === row.modelId}
                      onCheckedChange={(checked) =>
                        onEnabledChange(row, checked)
                      }
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canEnable ? "Tenant availability" : "Pricing unresolved"}
                </TooltipContent>
              </Tooltip>
            </div>

            {saveError ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {saveError}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="Provider">{CATALOG_PROVIDER_LABEL}</DetailItem>
              <DetailItem label="Canonical name">
                {row.canonicalDisplayName}
              </DetailItem>
              <DetailItem label="Model ID" className="sm:col-span-2">
                <code className="break-all text-xs">{row.modelId}</code>
              </DetailItem>
              <DetailItem label="Pricing">
                <span>{pricingText(row)}</span>
              </DetailItem>
              <DetailItem label="Pricing status">
                <Badge variant={pricingBadgeVariant(row.pricingStatus)}>
                  {row.pricingStatus}
                </Badge>
              </DetailItem>
              <DetailItem label="Status">
                <Badge variant={row.enabled ? "default" : "outline"}>
                  {row.enabled ? "enabled" : "disabled"}
                </Badge>
              </DetailItem>
              <DetailItem label="Pricing source">
                {row.pricingSource ?? "n/a"}
              </DetailItem>
              <DetailItem label="Last priced">
                {formatDateTime(row.lastPricedAt)}
              </DetailItem>
              <DetailItem label="Imported">
                {formatDateTime(row.importedAt)}
              </DetailItem>
              <DetailItem label="Import source">
                {row.importSource ?? "n/a"}
              </DetailItem>
              <DetailItem label="Capabilities" className="sm:col-span-2">
                {capabilities.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {capabilities.map((capability) => (
                      <Badge key={capability} variant="outline">
                        {capability}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  "n/a"
                )}
              </DetailItem>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!displayName.trim() || state.fetching}
            onClick={save}
          >
            {state.fetching ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 min-h-6 text-sm text-foreground">{children}</dd>
    </div>
  );
}
