import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsActivityThreadDetail as SettingsActivityThreadDetailView } from "@/components/settings/SettingsActivityThreadDetail";
import { isActivityDay } from "@/lib/settings-activity";

// The same operator Thread Detail view as Settings → Activity → Thread Detail,
// but mounted under _shell so opening it from a thread's Info Panel keeps the
// main chat sidebar (no Settings takeover). The Info Panel links here; the
// Settings copy at /settings/activity/$threadId stays for the Activity list.
export const Route = createFileRoute("/_authed/_shell/activity/$threadId")({
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day: isActivityDay(search.day) ? search.day : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <ShellActivityThreadDetail />
    </OperatorGuard>
  ),
});

function ShellActivityThreadDetail() {
  const { threadId } = Route.useParams();
  // Opened from a thread's Info Panel, so the trail leads back to the thread
  // (not the Chats list). The "Thread" breadcrumb links straight back to it.
  return (
    <SettingsActivityThreadDetailView
      threadId={threadId}
      breadcrumbParents={[{ label: "Thread", href: `/threads/${threadId}` }]}
    />
  );
}
