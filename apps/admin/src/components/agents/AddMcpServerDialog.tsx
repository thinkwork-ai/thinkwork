import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMcpServer,
  testMcpServer,
  type McpServerInput,
} from "@/lib/skills-api";

type Props = {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  connections?: Array<{ id: string; providerName: string; providerId: string; status: string }>;
};

export function AddMcpServerDialog({ agentId, open, onOpenChange, onAdded, connections }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("streamable-http");
  const [authType, setAuthType] = useState("none");
  const [apiKey, setApiKey] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [tools, setTools] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string } | null>(null);
  const [error, setError] = useState("");

  const activeConnections = (connections || []).filter((c) => c.status === "active");
  const selectedConnection = activeConnections.find((c) => c.id === connectionId);

  const reset = () => {
    setName("");
    setUrl("");
    setTransport("streamable-http");
    setAuthType("none");
    setApiKey("");
    setConnectionId("");
    setTools("");
    setTestResult(null);
    setError("");
  };

  const handleSave = async () => {
    if (!name || !url) return;
    setSaving(true);
    setError("");
    try {
      const config: McpServerInput = {
        name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        url,
        transport,
        authType: authType === "none" ? undefined : authType,
      };
      if (authType === "api-key" || authType === "bearer") {
        config.apiKey = apiKey;
      }
      if (authType === "oauth" && connectionId) {
        config.connectionId = connectionId;
        config.providerId = selectedConnection?.providerId;
      }
      if (tools.trim()) {
        config.tools = tools.split(",").map((t) => t.trim()).filter(Boolean);
      }
      await addMcpServer(agentId, config);
      reset();
      onOpenChange(false);
      onAdded();
    } catch (err: any) {
      setError(err.message || "Failed to add MCP server");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!name || !url) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Save first (so we have a row to test against), then test
      const config: McpServerInput = {
        name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        url,
        transport,
        authType: authType === "none" ? undefined : authType,
      };
      if (authType === "api-key" || authType === "bearer") {
        config.apiKey = apiKey;
      }
      if (authType === "oauth" && connectionId) {
        config.connectionId = connectionId;
        config.providerId = selectedConnection?.providerId;
      }
      const { skillId } = await addMcpServer(agentId, config);
      const result = await testMcpServer(agentId, skillId);
      setTestResult(result);
      if (result.ok && result.tools) {
        setTools(result.tools.map((t) => t.name).join(", "));
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const isValid = name.trim() && url.trim() && (authType === "none" || authType === "oauth" ? true : apiKey.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Connect an external MCP server to this agent. Tools from the server will be available during conversations.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. lastmile-crm"
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Transport</Label>
              <Select value={transport} onValueChange={setTransport}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Authentication</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api-key">API Key</SelectItem>
                  {activeConnections.length > 0 && (
                    <SelectItem value="oauth">OAuth Connection</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(authType === "bearer" || authType === "api-key") && (
            <div className="space-y-1">
              <Label htmlFor="mcp-apikey">
                {authType === "bearer" ? "Bearer Token" : "API Key"}
              </Label>
              <Input
                id="mcp-apikey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={authType === "bearer" ? "Bearer token..." : "API key..."}
              />
            </div>
          )}

          {authType === "oauth" && (
            <div className="space-y-1">
              <Label>OAuth Connection</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a connection..." />
                </SelectTrigger>
                <SelectContent>
                  {activeConnections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.providerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="mcp-tools">Tool Allowlist (optional)</Label>
            <Input
              id="mcp-tools"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="tool1, tool2, tool3"
            />
            <p className="text-xs text-muted-foreground">Comma-separated. Leave empty to allow all tools. Use "Test Connection" to auto-populate.</p>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${testResult.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-destructive/10 text-destructive"}`}>
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <div>
                {testResult.ok
                  ? `Connected successfully. ${testResult.tools?.length || 0} tools available.`
                  : `Connection failed: ${testResult.error}`}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!name.trim() || !url.trim() || testing}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Test Connection
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { reset(); onOpenChange(false); }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isValid || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Add Server
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
