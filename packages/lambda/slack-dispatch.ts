interface SlackDispatchEvent {
  type?: string;
}

export async function handler(event: SlackDispatchEvent): Promise<void> {
  console.log("Slack dispatch handler is not implemented yet", {
    type: event.type ?? "unknown",
  });
}
