import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { MessageInputFooter } from "@/components/input/MessageInputFooter";
import { toast } from "@/components/ui/toast";
import type { COLORS } from "@/lib/theme";
import { captureQueue } from "@/lib/offline/capture-queue";
import {
	newClientCaptureId,
	useCaptureQueue,
} from "@/lib/offline/use-capture-queue";
import { useDeleteMobileMemoryCapture } from "@thinkwork/react-native-sdk";

interface CaptureFooterProps {
	agentId: string | null | undefined;
	agentName: string | null | undefined;
	tenantId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	isDark: boolean;
}

export function CaptureFooter({
	agentId,
	agentName,
	tenantId,
	colors,
	isDark,
}: CaptureFooterProps) {
	const [text, setText] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const pendingCid = useRef<string | null>(null);
	const entries = useCaptureQueue();
	const deleteCapture = useDeleteMobileMemoryCapture();

	// When the last-submitted entry flips to synced, show the Undo toast.
	useEffect(() => {
		const cid = pendingCid.current;
		if (!cid) return;
		const entry = entries.find((e) => e.clientCaptureId === cid);
		if (!entry) return;
		if (entry.status === "synced" && entry.syncedId && entry.agentId) {
			pendingCid.current = null;
			const label = agentName || "your agent";
			const syncedId = entry.syncedId;
			const agentForUndo = entry.agentId;
			toast.show({
				message: `Saved to ${label}'s memory`,
				actionLabel: "Undo",
				durationMs: 5000,
				onAction: async () => {
					try {
						await deleteCapture({ agentId: agentForUndo, captureId: syncedId });
						await captureQueue.remove(cid);
					} catch {
						toast.show({
							message: "Couldn't undo — tap the memory to delete it.",
							tone: "error",
							durationMs: 3000,
						});
					}
				},
			});
		}
	}, [entries, agentName, deleteCapture]);

	const handleSubmit = useCallback(async () => {
		const trimmed = text.trim();
		if (!trimmed || submitting) return;
		if (!agentId || !tenantId) {
			Alert.alert("No agent selected", "Choose an agent before capturing a memory.");
			return;
		}
		setSubmitting(true);
		try {
			const cid = newClientCaptureId();
			pendingCid.current = cid;
			await captureQueue.enqueue({
				clientCaptureId: cid,
				tenantId,
				agentId,
				content: trimmed,
				factType: "FACT",
				metadata: {},
			});
			setText("");
			Keyboard.dismiss();
		} catch (err) {
			pendingCid.current = null;
			const message = err instanceof Error ? err.message : "Try again in a moment.";
			toast.show({ message: `Couldn't save: ${message}`, tone: "error", durationMs: 3000 });
		} finally {
			setSubmitting(false);
		}
	}, [text, submitting, agentId, tenantId]);

	const placeholder = agentName ? `Add new memory for ${agentName}...` : "Add new memory...";

	return (
		<MessageInputFooter
			value={text}
			onChangeText={setText}
			onSubmit={handleSubmit}
			placeholder={placeholder}
			colors={colors}
			isDark={isDark}
		/>
	);
}
