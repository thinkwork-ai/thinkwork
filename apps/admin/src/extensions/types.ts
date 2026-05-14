import type { ComponentType } from "react";

export interface AdminExtensionBreadcrumb {
  label: string;
  href?: string;
}

export interface AdminExtensionProxyClient {
  get<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T>;
  request<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export interface AdminExtensionComponentProps {
  extensionId: string;
  tenantId: string | null;
  proxyBasePath: string;
  proxy: AdminExtensionProxyClient;
}

export type AdminExtensionComponent =
  ComponentType<AdminExtensionComponentProps>;

export interface AdminExtensionDefinition {
  id: string;
  label: string;
  description?: string;
  navGroup?: "main" | "managed-harness" | "integrations" | "manage";
  breadcrumbs?: AdminExtensionBreadcrumb[];
  proxyBasePath?: string;
  icon?: ComponentType<{ className?: string }>;
  ownsPageLayout?: boolean;
  load: () => Promise<{
    default?: AdminExtensionComponent;
    Extension?: AdminExtensionComponent;
  }>;
}
