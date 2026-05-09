import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@thinkwork/ui";

interface AppletErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
}

interface AppletErrorBoundaryState {
  error: Error | null;
}

export class AppletErrorBoundary extends Component<
  AppletErrorBoundaryProps,
  AppletErrorBoundaryState
> {
  state: AppletErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // React still records the component stack in development; the UI keeps
    // the recoverable applet failure readable for end users.
  }

  componentDidUpdate(previousProps: AppletErrorBoundaryProps) {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.error !== null
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="rounded-lg border border-destructive/30 bg-background p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <div className="grid min-w-0 gap-3">
            <div>
              <h2 className="text-base font-semibold">
                This app could not render
              </h2>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {this.state.error.message || "The applet runtime failed."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="justify-self-start"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
