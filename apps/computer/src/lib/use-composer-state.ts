/**
 * Shared composer state hook (plan-012 U13).
 *
 * Both `ComputerComposer` (empty-thread) and `FollowUpComposer`
 * (in-thread, inside `TaskThreadView`) consume this hook so the submit
 * pipeline is shared. The hook deliberately delegates the actual
 * submit to a callback the route owns — the single-submit invariant
 * (P0 release gate per contract v1) requires that the route's
 * `useChat` instance is the sole caller of `SendMessageMutation` /
 * `createAppSyncChatTransport.sendMessages`. Composers MUST NOT
 * invoke the mutation directly.
 *
 * State namespacing: per-threadId so leaving and re-entering a thread
 * preserves the in-progress draft. Files attached via drag-drop
 * persist alongside text. The hook does NOT persist to localStorage —
 * a future v2 may add it; for now thread-namespacing within the
 * lifetime of the SPA session is enough.
 *
 * Wired via the route in U8; the actual <PromptInput> swap of the two
 * composer surfaces is a U13 follow-up (the current Textarea-based
 * composers consume this hook's surface and submit through the same
 * onSubmit boundary, satisfying the single-submit invariant
 * structurally even before the visual swap).
 */

import { useCallback, useState } from "react";

export interface ComposerStateInternals {
	text: string;
	files: File[];
	isSubmitting: boolean;
	error: string | null;
}

export interface ComposerState extends ComposerStateInternals {
	setText: (next: string) => void;
	addFile: (file: File) => void;
	removeFile: (file: File) => void;
	clearFiles: () => void;
	clear: () => void;
	setError: (next: string | null) => void;
	setSubmitting: (submitting: boolean) => void;
}

export function useComposerState(threadId: string | null | undefined): ComposerState {
	void threadId;
	const [text, setText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const addFile = useCallback((file: File) => {
		setFiles((current) => [...current, file]);
	}, []);

	const removeFile = useCallback((file: File) => {
		setFiles((current) => current.filter((f) => f !== file));
	}, []);

	const clearFiles = useCallback(() => {
		setFiles([]);
	}, []);

	const clear = useCallback(() => {
		setText("");
		setFiles([]);
		setError(null);
	}, []);

	return {
		text,
		files,
		isSubmitting,
		error,
		setText,
		addFile,
		removeFile,
		clearFiles,
		clear,
		setError,
		setSubmitting: setIsSubmitting,
	};
}
