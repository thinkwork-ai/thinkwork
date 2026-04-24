/**
 * ApiKeyDialog — tenant-wide API key management for a `tenant_api_key`
 * MCP server. Opened from the agent-template MCP Servers tab when an
 * admin enables an API-Key server that has no key configured yet, or
 * explicitly via the "Rotate" link when a key is already set.
 *
 * Site-wide scope: the key lives on `tenant_mcp_servers.auth_config.token`
 * (one key per tenant per server). Not per-agent, not per-user.
 *
 * Two save paths:
 *   - Generate + save — one-click mint, server-side. Admin never sees
 *     the raw token; only the last-4 preview returns in the response.
 *   - Paste existing — for ops who minted the token via the CLI (e.g.
 *     `thinkwork mcp key create -t <slug>` or `thinkwork mcp provision
 *     -t <slug>`) and want to register it here.
 *
 * On success the parent receives the last-4 and re-checks key status so
 * the row badge updates.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMcpApiKey } from "@/lib/mcp-api";

export interface ApiKeyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tenantSlug: string;
	serverId: string;
	serverName: string;
	/** Whether a key already exists — shifts the UI framing to "rotate". */
	isRotation: boolean;
	/** Called after a successful save so the parent can refetch key status and flip the toggle. */
	onSuccess: (lastFour: string) => void;
}

type Mode = "choose" | "paste" | "mint" | "saving";

export function ApiKeyDialog({
	open,
	onOpenChange,
	tenantSlug,
	serverId,
	serverName,
	isRotation,
	onSuccess,
}: ApiKeyDialogProps) {
	const [mode, setMode] = useState<Mode>("choose");
	const [pastedKey, setPastedKey] = useState("");
	const [error, setError] = useState<string | null>(null);

	function reset() {
		setMode("choose");
		setPastedKey("");
		setError(null);
	}

	function handleOpenChange(next: boolean) {
		if (!next) reset();
		onOpenChange(next);
	}

	async function submitPaste() {
		const trimmed = pastedKey.trim();
		if (!trimmed) {
			setError("API key is required");
			return;
		}
		setError(null);
		setMode("saving");
		try {
			const res = await setMcpApiKey(tenantSlug, serverId, { apiKey: trimmed });
			onSuccess(res.lastFour);
			reset();
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setMode("paste");
		}
	}

	async function submitMint() {
		setError(null);
		setMode("saving");
		try {
			const res = await setMcpApiKey(tenantSlug, serverId, { mintNew: true });
			onSuccess(res.lastFour);
			reset();
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setMode("choose");
		}
	}

	const title = isRotation ? `Rotate API key: ${serverName}` : `Configure API key: ${serverName}`;
	const description = isRotation
		? "Replace the stored API key for this MCP server. The previous key is revoked server-side; callers using it will start returning 401 after the next deploy."
		: "This MCP server uses tenant API-key auth. You need to configure a key before agents can call it. The key is stored tenant-wide (not per-user or per-agent).";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{mode === "choose" && (
					<div className="space-y-4 py-2">
						<Button
							variant="default"
							className="w-full justify-start"
							onClick={submitMint}
						>
							<div className="flex flex-col items-start">
								<span className="font-medium">Generate and save a new key</span>
								<span className="text-xs font-normal text-muted-foreground">
									Creates a new {serverName.toLowerCase().includes("admin") ? "tkm_" : ""}token server-side. Recommended.
								</span>
							</div>
						</Button>

						<Button
							variant="outline"
							className="w-full justify-start"
							onClick={() => setMode("paste")}
						>
							<div className="flex flex-col items-start">
								<span className="font-medium">Paste an existing key</span>
								<span className="text-xs font-normal text-muted-foreground">
									For keys minted via the CLI.
								</span>
							</div>
						</Button>

						<div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
							<div className="mb-1 font-medium">CLI alternative</div>
							<div className="text-muted-foreground">
								Generate a key without this dialog:
							</div>
							<pre className="mt-1 rounded bg-background/60 px-2 py-1 font-mono text-[11px]">
								thinkwork mcp provision -t {tenantSlug}
							</pre>
							<div className="mt-2 text-muted-foreground">
								This mints a key, stores it in Secrets Manager, and registers
								it on this MCP server in one step. Then reload this page —
								you'll see the last 4 characters here.
							</div>
						</div>
					</div>
				)}

				{mode === "paste" && (
					<div className="space-y-3 py-2">
						<Label htmlFor="api-key-input">API key</Label>
						<Input
							id="api-key-input"
							type="text"
							placeholder="tkm_…"
							value={pastedKey}
							onChange={(e) => setPastedKey(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") submitPaste();
							}}
							autoFocus
						/>
						<p className="text-xs text-muted-foreground">
							Paste the token output from{" "}
							<code className="rounded bg-muted px-1 py-0.5 text-[11px]">
								thinkwork mcp key create -t {tenantSlug}
							</code>
							. Stored in Secrets Manager; only the last 4 characters are
							displayed in this UI.
						</p>
					</div>
				)}

				{mode === "saving" && (
					<div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Saving…
					</div>
				)}

				{error && (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</div>
				)}

				<DialogFooter>
					{mode === "paste" && (
						<>
							<Button variant="ghost" onClick={() => setMode("choose")}>
								Back
							</Button>
							<Button onClick={submitPaste} disabled={!pastedKey.trim()}>
								Save key
							</Button>
						</>
					)}
					{mode !== "paste" && mode !== "saving" && (
						<Button variant="ghost" onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
