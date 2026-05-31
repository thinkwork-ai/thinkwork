export type ChangedFileOp = "create" | "modify" | "delete";

export interface ChangedFilePayload {
  path: string;
  op: ChangedFileOp;
  content?: string;
  base_etag?: string;
}

export interface ChangedFileValidationError {
  index: number;
  path: string | null;
  code:
    | "invalid_shape"
    | "invalid_op"
    | "invalid_path"
    | "content_required"
    | "content_forbidden"
    | "content_too_large";
  message: string;
}

export interface ReconcileReport {
  status: "no_changes";
  files: [];
}

export interface ReconcileChangedFilesInput {
  tenantId: string;
  agentId: string;
  threadId: string;
  threadTurnId: string;
  changedFiles: ChangedFilePayload[];
}

export class ReconcileNotImplementedError extends Error {
  readonly code = "ReconcileNotImplemented";

  constructor() {
    super("Workspace reconcile is not implemented yet.");
    this.name = "ReconcileNotImplementedError";
  }
}

export const CHANGED_FILE_LIMITS = {
  maxFiles: 100,
  maxPathBytes: 512,
  maxContentBytes: 256 * 1024,
  maxTotalContentBytes: 1024 * 1024,
} as const;

export function validateChangedFiles(
  input: unknown,
):
  | { ok: true; changedFiles: ChangedFilePayload[] }
  | { ok: false; errors: ChangedFileValidationError[] } {
  if (input === undefined || input === null) {
    return { ok: true, changedFiles: [] };
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          index: -1,
          path: null,
          code: "invalid_shape",
          message: "changed_files must be an array.",
        },
      ],
    };
  }

  const errors: ChangedFileValidationError[] = [];
  const changedFiles: ChangedFilePayload[] = [];
  if (input.length > CHANGED_FILE_LIMITS.maxFiles) {
    errors.push({
      index: -1,
      path: null,
      code: "invalid_shape",
      message: `changed_files must contain at most ${CHANGED_FILE_LIMITS.maxFiles} files.`,
    });
  }

  let totalContentBytes = 0;
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({
        index,
        path: null,
        code: "invalid_shape",
        message: "changed file must be an object.",
      });
      return;
    }

    const file = raw as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : null;
    const op = file.op;
    const content = file.content;
    const baseEtag = file.base_etag;

    if (!path || !isCanonicalRelativePath(path)) {
      errors.push({
        index,
        path,
        code: "invalid_path",
        message: "path must be a canonical relative workspace path.",
      });
    } else if (
      Buffer.byteLength(path, "utf8") > CHANGED_FILE_LIMITS.maxPathBytes
    ) {
      errors.push({
        index,
        path,
        code: "invalid_path",
        message: `path must be at most ${CHANGED_FILE_LIMITS.maxPathBytes} bytes.`,
      });
    }

    if (op !== "create" && op !== "modify" && op !== "delete") {
      errors.push({
        index,
        path,
        code: "invalid_op",
        message: "op must be create, modify, or delete.",
      });
    }

    if ((op === "create" || op === "modify") && typeof content !== "string") {
      errors.push({
        index,
        path,
        code: "content_required",
        message: "content is required for create and modify operations.",
      });
    }
    if (op === "delete" && content !== undefined) {
      errors.push({
        index,
        path,
        code: "content_forbidden",
        message: "content is not allowed for delete operations.",
      });
    }

    if (typeof content === "string") {
      const contentBytes = Buffer.byteLength(content, "utf8");
      totalContentBytes += contentBytes;
      if (contentBytes > CHANGED_FILE_LIMITS.maxContentBytes) {
        errors.push({
          index,
          path,
          code: "content_too_large",
          message: `content must be at most ${CHANGED_FILE_LIMITS.maxContentBytes} bytes.`,
        });
      }
    }

    if (baseEtag !== undefined && typeof baseEtag !== "string") {
      errors.push({
        index,
        path,
        code: "invalid_shape",
        message: "base_etag must be a string when present.",
      });
    }

    if (
      path &&
      isCanonicalRelativePath(path) &&
      (op === "create" || op === "modify" || op === "delete")
    ) {
      changedFiles.push({
        path,
        op,
        ...(typeof content === "string" ? { content } : {}),
        ...(typeof baseEtag === "string" ? { base_etag: baseEtag } : {}),
      });
    }
  });

  if (totalContentBytes > CHANGED_FILE_LIMITS.maxTotalContentBytes) {
    errors.push({
      index: -1,
      path: null,
      code: "content_too_large",
      message: `total changed file content must be at most ${CHANGED_FILE_LIMITS.maxTotalContentBytes} bytes.`,
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, changedFiles };
}

export async function reconcileChangedFiles(
  input: ReconcileChangedFilesInput,
): Promise<ReconcileReport> {
  if (input.changedFiles.length === 0) {
    return { status: "no_changes", files: [] };
  }
  throw new ReconcileNotImplementedError();
}

function isCanonicalRelativePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }
  return path === segments.join("/");
}
