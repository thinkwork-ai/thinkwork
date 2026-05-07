import { type ComponentType } from "react";
import { HardDrive, Server, Workflow } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type Computer } from "@/gql/graphql";
import { relativeTime } from "@/lib/utils";

type ComputerRuntimePanelProps = {
  computer: Pick<
    Computer,
    | "runtimeStatus"
    | "liveWorkspaceRoot"
    | "efsAccessPointId"
    | "ecsServiceName"
    | "lastHeartbeatAt"
    | "runtimeConfig"
  >;
};

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RuntimeRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm">{value || "—"}</div>
      </div>
    </div>
  );
}

export function ComputerRuntimePanel({ computer }: ComputerRuntimePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Runtime</CardTitle>
        <CardDescription>
          ECS/EFS identifiers and heartbeat data for the live Computer worker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {label(computer.runtimeStatus)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Last heartbeat{" "}
            {computer.lastHeartbeatAt
              ? relativeTime(computer.lastHeartbeatAt)
              : "not observed"}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <RuntimeRow
            icon={HardDrive}
            label="Workspace Root"
            value={computer.liveWorkspaceRoot}
          />
          <RuntimeRow
            icon={Workflow}
            label="EFS Access Point"
            value={computer.efsAccessPointId}
          />
          <RuntimeRow
            icon={Server}
            label="ECS Service"
            value={computer.ecsServiceName}
          />
        </div>
      </CardContent>
    </Card>
  );
}
