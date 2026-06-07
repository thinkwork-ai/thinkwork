import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTenant } from "@/context/TenantContext";

/**
 * Route-level guard for operator-only settings sections. Members who reach an
 * operator route via direct link or browser history are redirected to General
 * with no error flash. Renders nothing until the role is resolved.
 *
 * This is defense-in-depth alongside the server-side gates (U8) — the backend
 * is the real boundary; this just keeps the UX clean.
 */
export function OperatorGuard({ children }: { children: ReactNode }) {
  const { isOperator, roleResolved } = useTenant();
  if (!roleResolved) return null;
  if (!isOperator) return <Navigate to="/settings/general" />;
  return <>{children}</>;
}
