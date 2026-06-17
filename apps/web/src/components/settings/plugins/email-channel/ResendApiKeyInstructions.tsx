export function ResendApiKeyInstructions() {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Resend API key</p>
      <p className="mt-1">
        Open the Resend API Keys dashboard, create a dedicated ThinkWork
        production key, and copy it immediately because Resend only displays the
        value once.
      </p>
      <p className="mt-2">
        This one-key setup lets ThinkWork create the Resend webhook and use the
        tenant&apos;s *.thinkwork.ai email domain automatically. Use a dedicated
        production key with the permissions needed to manage webhooks and send
        from that domain.
      </p>
      <a
        className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
        href="https://resend.com/docs/dashboard/api-keys/introduction"
        target="_blank"
        rel="noreferrer"
      >
        Resend API key docs
      </a>
    </div>
  );
}
