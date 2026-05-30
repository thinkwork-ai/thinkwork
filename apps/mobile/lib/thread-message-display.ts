export interface MessageSenderDisplayInput {
  sender?: {
    displayName?: string | null;
    id?: string | null;
  } | null;
  senderId?: string | null;
}

export interface HumanMessageDisplay {
  label: string;
  initials: string | null;
  isCurrentUser: boolean;
}

export function resolveHumanMessageDisplay(
  message: MessageSenderDisplayInput,
  currentUserId?: string | null,
): HumanMessageDisplay {
  const senderId = message.sender?.id ?? message.senderId ?? null;
  const isCurrentUser = Boolean(
    currentUserId && senderId && currentUserId === senderId,
  );
  if (isCurrentUser) {
    return { label: "You", initials: null, isCurrentUser: true };
  }

  const displayName = message.sender?.displayName?.trim();
  const label = displayName || "User";
  return {
    label,
    initials: initialsForName(label),
    isCurrentUser: false,
  };
}

export function initialsForName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "U";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[words.length - 1]![0] ?? ""}`.toUpperCase();
}
