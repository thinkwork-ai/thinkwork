import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  MAX_AGENTCORE_CODE_INTERPRETER_SESSION_TIMEOUT_SECONDS,
  type SandboxFactory,
  type SessionEnv,
} from "@thinkwork/pi-aws";
import { Type } from "typebox";

const STDOUT_LIMIT_BYTES = 256 * 1024;
const STDERR_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS =
  MAX_AGENTCORE_CODE_INTERPRETER_SESSION_TIMEOUT_SECONDS * 1000;
const MAX_OUTPUT_FILES = 5;
const EXPORT_PRESIGN_SECONDS = 300;

/**
 * Libraries the AWS-managed Code Interpreter image may lack, keyed by the
 * code signals that predict their use. AgentCore CreateCodeInterpreter has
 * NO custom-image parameter (verified against SDK 3.1103.0 — the
 * Dockerfile.sandbox-base substrate is unattachable), so the only way to
 * guarantee a library is a runtime install. The guard below installs
 * inline, inside the same tool call, only when the code references the
 * library — one ~5-10s cost per sandbox session instead of a full
 * ImportError → model-retry round trip.
 */
const ON_DEMAND_LIBRARIES: Array<{ module: string; pattern: RegExp }> = [
  { module: "openpyxl", pattern: /openpyxl|\.xlsx/i },
];

function libraryInstallPreamble(code: string): string[] {
  return ON_DEMAND_LIBRARIES.filter((lib) => lib.pattern.test(code)).map(
    (lib) =>
      `python3 -c "import ${lib.module}" 2>/dev/null || pip install --quiet ${lib.module} || true`,
  );
}

const EXPORT_MIME_BY_EXTENSION: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};

function exportMimeType(filename: string): string {
  return (
    EXPORT_MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ??
    "application/octet-stream"
  );
}

/** In-sandbox uploader: the sandbox PUTs its own file to a presigned URL.
 * This is the only binary-safe egress — AgentCore CI readFiles is
 * text-decoded and corrupts non-UTF8 bytes (xlsx is a zip). */
function pythonUploadCommand(filePath: string, presignedUrl: string): string {
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
  const encodedUrl = Buffer.from(presignedUrl, "utf8").toString("base64");
  const script = [
    "import base64, sys, urllib.request",
    `file_path = base64.b64decode("${encodedPath}").decode("utf-8")`,
    `url = base64.b64decode("${encodedUrl}").decode("utf-8")`,
    "with open(file_path, 'rb') as fh:",
    "    data = fh.read()",
    "request = urllib.request.Request(url, data=data, method='PUT')",
    "with urllib.request.urlopen(request, timeout=60) as response:",
    "    print(f'uploaded {len(data)} bytes status {response.status}')",
  ].join("\n");
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return [
    "python3 - <<'PY'",
    "import base64",
    `code = base64.b64decode("${encoded}").decode("utf-8")`,
    'exec(compile(code, "<thinkwork-export-file>", "exec"))',
    "PY",
  ].join("\n");
}

export interface ExecuteCodeExportContext {
  workspaceBucket: string;
  tenantId: string;
  threadId: string;
  apiUrl: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
  s3?: S3Client;
}

function truncate(
  value: string,
  limit: number,
): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= limit) return { text: value, truncated: false };
  return {
    text: Buffer.from(value, "utf8").subarray(0, limit).toString("utf8"),
    truncated: true,
  };
}

function pythonCommandFor(code: string): string {
  const encoded = Buffer.from(code, "utf8").toString("base64");
  return [
    "python3 - <<'PY'",
    "import base64",
    `code = base64.b64decode("${encoded}").decode("utf-8")`,
    'exec(compile(code, "<thinkwork-execute-code>", "exec"))',
    "PY",
  ].join("\n");
}

export interface ExecuteCodeToolOptions {
  sandboxFactory: SandboxFactory;
  cleanup: Array<() => Promise<void>>;
  cwd?: string;
  timeoutMs?: number;
  /** When present, `output_files` exports become thread attachments. */
  exportContext?: ExecuteCodeExportContext;
}

interface ExportedFile {
  attachment_id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
}

async function exportOutputFile(
  env: SessionEnv,
  context: ExecuteCodeExportContext,
  sandboxPath: string,
): Promise<ExportedFile> {
  const filename = path.basename(sandboxPath).replace(/[^\w.() -]/g, "_");
  if (!filename || filename.startsWith(".")) {
    throw new Error(
      `output_files entry has an unusable filename: ${sandboxPath}`,
    );
  }
  const mimeType = exportMimeType(filename);
  const s3 = context.s3 ?? new S3Client({});
  const s3Key = `tenants/${context.tenantId}/attachments/${context.threadId}/${randomUUID()}/${filename}`;
  const presignedUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: context.workspaceBucket, Key: s3Key }),
    { expiresIn: EXPORT_PRESIGN_SECONDS },
  );

  const upload = await env.exec(
    pythonUploadCommand(sandboxPath, presignedUrl),
    {
      cwd: env.cwd,
      timeout: 120_000,
    },
  );
  if (upload.exitCode !== 0) {
    throw new Error(
      `Failed to upload ${sandboxPath} from the sandbox: ${(upload.stderr || upload.stdout || "unknown error").slice(0, 400)}`,
    );
  }

  const fetchImpl = context.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${context.apiUrl.replace(/\/+$/, "")}/api/threads/${context.threadId}/attachments/register`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.apiSecret}`,
        "Content-Type": "application/json",
        "x-tenant-id": context.tenantId,
        "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
      },
      body: JSON.stringify({ name: filename, s3Key, mimeType }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Attachment registration failed for ${filename}: HTTP ${response.status} ${detail.slice(0, 300)}`,
    );
  }
  const registered = (await response.json()) as {
    attachmentId: string;
    sizeBytes: number;
  };
  return {
    attachment_id: registered.attachmentId,
    name: filename,
    size_bytes: registered.sizeBytes,
    mime_type: mimeType,
  };
}

export function buildExecuteCodeTool(
  options: ExecuteCodeToolOptions,
): AgentTool<any> {
  let session: SessionEnv | null = null;

  async function getSession(): Promise<SessionEnv> {
    if (session) return session;
    session = await options.sandboxFactory.createSessionEnv({
      id: "pi-execute-code",
      cwd: options.cwd ?? "/home/user",
    });
    if (session.cleanup) {
      options.cleanup.push(() => session?.cleanup?.() ?? Promise.resolve());
    }
    return session;
  }

  return {
    name: "execute_code",
    label: "Code Interpreter",
    description:
      "Run Python code in the tenant's AgentCore Code Interpreter sandbox. " +
      "Use this for data analysis, calculations, and short scripts. " +
      "openpyxl is auto-installed when your code references it — just " +
      "`import openpyxl` and write .xlsx workbooks directly. To produce a " +
      "downloadable file, write it to disk and list its path in " +
      "`output_files`; each becomes a thread attachment whose id can be " +
      "passed to send_email `attachments`.",
    parameters: Type.Object({
      code: Type.String({
        description: "Python code to execute.",
      }),
      output_files: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Absolute sandbox paths of files the code created that should " +
            "be exported as downloadable thread attachments (max 5).",
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const code = String((params as { code?: unknown }).code ?? "");
      if (!code.trim()) {
        throw new Error("execute_code requires a non-empty `code` string.");
      }
      const rawOutputFiles = (params as { output_files?: unknown })
        .output_files;
      const outputFiles = Array.isArray(rawOutputFiles)
        ? rawOutputFiles.map((entry) => String(entry)).filter(Boolean)
        : [];
      if (outputFiles.length > MAX_OUTPUT_FILES) {
        throw new Error(
          `execute_code supports at most ${MAX_OUTPUT_FILES} output_files.`,
        );
      }
      if (outputFiles.length > 0 && !options.exportContext) {
        throw new Error(
          "output_files export is not available in this session (no workspace attachment context).",
        );
      }

      const env = await getSession();
      const started = Date.now();
      const preamble = libraryInstallPreamble(code);
      const command =
        preamble.length > 0
          ? [...preamble, pythonCommandFor(code)].join("\n")
          : pythonCommandFor(code);
      const result = await env.exec(command, {
        cwd: env.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const stdout = truncate(result.stdout ?? "", STDOUT_LIMIT_BYTES);
      const stderr = truncate(result.stderr ?? "", STDERR_LIMIT_BYTES);

      const exported: ExportedFile[] = [];
      const exportErrors: string[] = [];
      if (result.exitCode === 0 && outputFiles.length > 0) {
        for (const sandboxPath of outputFiles) {
          try {
            exported.push(
              await exportOutputFile(env, options.exportContext!, sandboxPath),
            );
          } catch (err) {
            exportErrors.push(err instanceof Error ? err.message : String(err));
          }
        }
      } else if (outputFiles.length > 0) {
        exportErrors.push(
          "output_files were not exported because the code exited non-zero.",
        );
      }

      const summary = [
        `exit_code: ${result.exitCode}`,
        stdout.text ? `stdout:\n${stdout.text}` : "",
        stderr.text ? `stderr:\n${stderr.text}` : "",
        stdout.truncated ? "[stdout truncated]" : "",
        stderr.truncated ? "[stderr truncated]" : "",
        exported.length > 0
          ? `exported files (downloadable thread attachments; pass attachment_id to send_email attachments):\n${exported
              .map(
                (file) =>
                  `- ${file.name} (attachment_id: ${file.attachment_id}, ${file.size_bytes} bytes)`,
              )
              .join("\n")}`
          : "",
        exportErrors.length > 0
          ? `export errors:\n${exportErrors.map((message) => `- ${message}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: [{ type: "text", text: summary || "No output." }],
        details: {
          ok: result.exitCode === 0,
          exit_code: result.exitCode,
          exit_status: result.exitCode === 0 ? "ok" : "error",
          duration_ms: Date.now() - started,
          stdout: stdout.text,
          stderr: stderr.text,
          stdout_bytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
          stderr_bytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
          stdout_truncated: stdout.truncated,
          stderr_truncated: stderr.truncated,
          output_files: exported,
          output_file_errors: exportErrors,
          error: result.exitCode === 0 ? null : "SandboxError",
          error_message:
            result.exitCode === 0
              ? null
              : `Process exited with status ${result.exitCode}`,
          runtime: "pi",
        },
      };
    },
  };
}
