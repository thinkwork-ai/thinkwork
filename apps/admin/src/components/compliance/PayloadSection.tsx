import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PayloadSectionProps {
  payload: unknown;
  eventId: string;
}

const INLINE_BYTE_LIMIT = 256 * 1024; // 256 KB
const PREVIEW_CHAR_LIMIT = 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PayloadSection({ payload, eventId }: PayloadSectionProps) {
  if (payload === null || payload === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Payload not recorded for this event.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The GraphQL `payload` field is `AWSJSON!` — codegen surfaces a string at
  // runtime when the resolver returns `JSON.stringify(...)`, otherwise a
  // structured object. Normalize both.
  const json =
    typeof payload === "string"
      ? safePrettyPrint(payload)
      : JSON.stringify(payload, null, 2);
  const bytes = new Blob([json]).size;
  const isLarge = bytes > INLINE_BYTE_LIMIT;

  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `compliance-event-${eventId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Payload{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({formatBytes(bytes)})
          </span>
        </CardTitle>
        {isLarge ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDownload}
          >
            <Download className="size-3.5" />
            Download full payload
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLarge ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Payload exceeds {formatBytes(INLINE_BYTE_LIMIT)} — showing first
              1 KB preview. Use Download for the full record.
            </p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted p-3 rounded-md">
              {json.slice(0, PREVIEW_CHAR_LIMIT)}
              {json.length > PREVIEW_CHAR_LIMIT ? "\n..." : ""}
            </pre>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 max-h-96 rounded-md border">
            <pre className="font-mono text-xs p-3 whitespace-pre-wrap break-words">
              {json}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function safePrettyPrint(rawJsonString: string): string {
  try {
    return JSON.stringify(JSON.parse(rawJsonString), null, 2);
  } catch {
    return rawJsonString;
  }
}
