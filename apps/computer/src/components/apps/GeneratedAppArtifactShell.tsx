import type { ReactNode } from "react";
import {
  Artifact,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactLabel,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { cn } from "@/lib/utils";

export type GeneratedAppRuntimeMode = "sandboxedGenerated" | "nativeTrusted";

export interface GeneratedAppArtifactShellProps {
  title: string;
  description?: string | null;
  label?: string;
  runtimeMode?: GeneratedAppRuntimeMode;
  actions?: ReactNode;
  children: ReactNode;
  showHeader?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

export function GeneratedAppArtifactShell({
  title,
  description,
  label = "App",
  runtimeMode = "sandboxedGenerated",
  actions,
  children,
  showHeader = true,
  className,
  headerClassName,
  contentClassName,
}: GeneratedAppArtifactShellProps) {
  const hasDescription = Boolean(description?.trim());

  return (
    <Artifact
      className={cn("border-border/70 bg-background/70 shadow-none", className)}
      data-generated-app-artifact=""
      data-runtime-mode={runtimeMode}
    >
      {showHeader ? (
        <ArtifactHeader className={cn("gap-3 bg-transparent", headerClassName)}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ArtifactTitle className="truncate">{title}</ArtifactTitle>
              <ArtifactLabel>{label}</ArtifactLabel>
            </div>
            {hasDescription ? (
              <ArtifactDescription className="mt-1 leading-5">
                {description}
              </ArtifactDescription>
            ) : null}
          </div>
          {actions ? <ArtifactActions>{actions}</ArtifactActions> : null}
        </ArtifactHeader>
      ) : null}
      <ArtifactContent className={cn("p-0", contentClassName)}>
        {children}
      </ArtifactContent>
    </Artifact>
  );
}
