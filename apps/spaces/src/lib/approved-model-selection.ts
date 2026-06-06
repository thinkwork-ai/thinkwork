export interface ApprovedModelOption {
  id?: string | null;
  modelId: string;
  displayName: string;
  provider: string;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
}

export const APPROVED_MODEL_STORAGE_KEY = "thinkwork.spaces.selectedModelId";

export function formatModelProvider(provider: string) {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPerMillionCost(cost: number | null | undefined) {
  if (cost == null || !Number.isFinite(cost)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(cost);
}

export function formatModelCostLine(model: ApprovedModelOption) {
  return `${formatPerMillionCost(
    model.inputCostPerMillion,
  )} input / ${formatPerMillionCost(
    model.outputCostPerMillion,
  )} output per 1M tokens`;
}

export function chooseApprovedModelId(
  models: ApprovedModelOption[] | null | undefined,
  preferredModelId?: string | null,
) {
  if (!models || models.length === 0) {
    return null;
  }

  if (preferredModelId) {
    const preferred = models.find(
      (model) => model.modelId === preferredModelId,
    );
    if (preferred) {
      return preferred.modelId;
    }
  }

  return models[0]?.modelId ?? null;
}

export function readStoredModelId(
  storage: Storage | undefined = globalThis.localStorage,
) {
  try {
    return storage?.getItem(APPROVED_MODEL_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredModelId(
  modelId: string | null,
  storage: Storage | undefined = globalThis.localStorage,
) {
  try {
    if (!storage) return;
    if (modelId) {
      storage.setItem(APPROVED_MODEL_STORAGE_KEY, modelId);
    } else {
      storage.removeItem(APPROVED_MODEL_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in embedded or private contexts.
  }
}
