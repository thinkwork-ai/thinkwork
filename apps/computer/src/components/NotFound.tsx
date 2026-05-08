import { Link } from "@tanstack/react-router";
import { Button } from "@thinkwork/ui";

export function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Not found</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        This path doesn't exist on computer.thinkwork.ai. If you're looking for an
        admin surface (People, Billing, Compliance, etc.), they live at
        admin.thinkwork.ai.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/computer">Back to your Computer</Link>
      </Button>
    </div>
  );
}
