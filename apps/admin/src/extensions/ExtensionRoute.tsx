import { lazy, Suspense, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { useTenant } from "@/context/TenantContext";
import { apiFetch } from "@/lib/api-fetch";
import { getAdminExtension } from "./registry";
import type {
  AdminExtensionComponent,
  AdminExtensionProxyClient,
} from "./types";

export function ExtensionRoute({ extensionId }: { extensionId: string }) {
  const extension = getAdminExtension(extensionId);
  const { tenantId } = useTenant();

  const proxy = useMemo(
    () =>
      extension
        ? createProxyClient(
            extension.proxyBasePath ?? `/api/extensions/${extension.id}`,
            tenantId,
          )
        : null,
    [extension, tenantId],
  );

  if (!extension || !proxy) {
    return (
      <PageLayout
        header={<PageHeader title="Extension unavailable" />}
        contentClassName="flex items-center justify-center"
      >
        <div className="flex max-w-md items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            The requested extension is not enabled for this Admin build.
          </span>
        </div>
      </PageLayout>
    );
  }

  const Component = lazy(async () => {
    const module = await extension.load();
    const Loaded = module.default ?? module.Extension;
    if (!Loaded) {
      throw new Error(`Extension "${extension.id}" did not export a component`);
    }
    return { default: Loaded as AdminExtensionComponent };
  });

  return (
    <PageLayout header={<PageHeader title={extension.label} />}>
      <Suspense
        fallback={
          <div className="text-sm text-muted-foreground">Loading...</div>
        }
      >
        <Component
          extensionId={extension.id}
          tenantId={tenantId}
          proxyBasePath={
            extension.proxyBasePath ?? `/api/extensions/${extension.id}`
          }
          proxy={proxy}
        />
      </Suspense>
    </PageLayout>
  );
}

function createProxyClient(
  proxyBasePath: string,
  tenantId: string | null,
): AdminExtensionProxyClient {
  const request = async <T,>(path: string, init: RequestInit = {}) => {
    return apiFetch<T>(joinProxyPath(proxyBasePath, path), {
      ...init,
      extraHeaders: tenantId ? { "x-tenant-id": tenantId } : undefined,
    });
  };
  return {
    request,
    get: (path, init) => request(path, { ...init, method: "GET" }),
    post: (path, body, init) =>
      request(path, {
        ...init,
        method: "POST",
        body: body === undefined ? init?.body : JSON.stringify(body),
      }),
  };
}

function joinProxyPath(base: string, path: string) {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
