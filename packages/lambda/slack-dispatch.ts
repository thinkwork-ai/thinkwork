interface SlackDispatchEvent {
  type?: string;
  botToken?: string;
  channelId?: string;
  threadTs?: string;
  text?: string;
}

export async function handler(
  event: SlackDispatchEvent,
): Promise<{ ok: boolean; ts?: string | null; skipped?: boolean }> {
  if (
    event.type !== "placeholder" ||
    !event.botToken ||
    !event.channelId ||
    !event.text
  ) {
    console.log("Slack dispatch handler skipped unsupported event", {
      type: event.type ?? "unknown",
    });
    return { ok: true, skipped: true };
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${event.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: event.channelId,
      text: event.text,
      thread_ts: event.threadTs || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack placeholder post failed with ${response.status}`);
  }
  const body = (await response.json()) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };
  if (!body.ok) {
    throw new Error(
      `Slack placeholder post failed: ${body.error ?? "unknown"}`,
    );
  }
  return { ok: true, ts: body.ts ?? null };
}
