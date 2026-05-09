import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Bot } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { getGoogleSignInUrl } from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  // If the user is already signed in, send them to /threads.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate({ to: "/threads", replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  function handleGoogle() {
    window.location.href = getGoogleSignInUrl();
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <Bot className="h-8 w-8 text-primary" />
        <span className="text-2xl font-semibold tracking-tight">ThinkWork Computer</span>
      </div>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Sign in with the Google account associated with your tenant.
      </p>
      <Button onClick={handleGoogle} size="lg" className="min-w-[280px]">
        Continue with Google
      </Button>
      <p className="text-xs text-muted-foreground">
        ThinkWork Computer is the desktop end-user surface for your AI workplace.
      </p>
    </div>
  );
}
