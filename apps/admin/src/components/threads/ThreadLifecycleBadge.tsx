import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useActiveTurnsStore } from "@/stores/active-turns-store";

// ThreadLifecycleStatus enum mirror — keep in sync with
// packages/database-pg/graphql/types/threads.graphql.
// AWAITING_USER is reserved; v1 never emits it and this component renders
// it as IDLE styling if it ever arrives.
type LifecycleStatus =
	| "RUNNING"
	| "COMPLETED"
	| "CANCELLED"
	| "FAILED"
	| "IDLE"
	| "AWAITING_USER";

const styles: Record<LifecycleStatus, { dot: string; badge: string; label: string }> = {
	RUNNING: {
		dot: "bg-blue-500 animate-pulse",
		badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
		label: "Running",
	},
	COMPLETED: {
		dot: "bg-green-500",
		badge: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
		label: "Completed",
	},
	CANCELLED: {
		dot: "bg-yellow-500",
		badge: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
		label: "Cancelled",
	},
	FAILED: {
		dot: "bg-red-500",
		badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
		label: "Failed",
	},
	IDLE: {
		dot: "bg-gray-400",
		badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
		label: "Idle",
	},
	// AWAITING_USER is reserved in the enum but not emitted by v1.
	// Render as IDLE styling so the UI degrades gracefully if it ever arrives.
	AWAITING_USER: {
		dot: "bg-gray-400",
		badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
		label: "Awaiting user",
	},
};

interface ThreadLifecycleBadgeProps {
	/** Resolver-derived status. Null during initial fetch or on loader error. */
	lifecycleStatus: LifecycleStatus | null | undefined;
	/** Thread id — used to consult the active-turns store for real-time override. */
	threadId: string;
	/** When true and there's no prior value, render a skeleton pulse. */
	loading?: boolean;
	size?: "sm" | "md";
	className?: string;
}

/**
 * Derived lifecycle badge for a thread. Source priority:
 *   1. Active-turns store (real-time; if the client knows about an active
 *      turn for this thread, force RUNNING regardless of the resolver).
 *   2. The `lifecycleStatus` prop from the GraphQL resolver.
 *
 * When `loading` is true and no prior value is available, the badge
 * renders a skeleton pulse (same dimensions as the real badge).
 */
export function ThreadLifecycleBadge({
	lifecycleStatus,
	threadId,
	loading = false,
	size = "md",
	className,
}: ThreadLifecycleBadgeProps) {
	const activeThreadIds = useActiveTurnsStore((s) => s._activeThreadIds);
	const hasActiveTurn = activeThreadIds.has(threadId);

	// Active-turn override wins. Falls through to the resolver-derived status.
	const effective: LifecycleStatus | null = hasActiveTurn
		? "RUNNING"
		: (lifecycleStatus ?? null);

	if (!effective) {
		if (loading) {
			return (
				<span
					className={cn(
						"inline-block rounded-full bg-muted animate-pulse",
						size === "sm" ? "h-4 w-16" : "h-5 w-20",
						className,
					)}
					aria-label="Loading lifecycle status"
				/>
			);
		}
		// No data and not loading — nothing to render.
		return null;
	}

	const s = styles[effective];

	return (
		<Badge
			variant="outline"
			className={cn(
				"border-transparent font-medium",
				s.badge,
				size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5",
				className,
			)}
		>
			<span
				className={cn(
					"shrink-0 rounded-full",
					size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
					s.dot,
				)}
			/>
			{s.label}
		</Badge>
	);
}
