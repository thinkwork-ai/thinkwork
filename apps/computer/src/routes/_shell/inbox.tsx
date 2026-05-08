import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_shell/inbox")({
  component: InboxPage,
});

function InboxPage() {
  return (
    <PlaceholderPage
      title="Inbox"
      subtitle="Pending items waiting on your attention — approvals, notifications, escalations. Real inbox surface lands in the next phase."
    />
  );
}
