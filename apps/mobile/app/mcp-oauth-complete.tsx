import { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/typography";

/**
 * Deep-link target for the MCP OAuth flow.
 *
 * We open the IdP's authorize page in real Safari via `Linking.openURL`
 * (rather than an in-app browser) because iOS in-app presenters like
 * `ASWebAuthenticationSession` isolate cookies in a way that breaks
 * Clerk's SDK — it can't persist `__session` / `__client` across the
 * sign-in POST + redirect chain, so the form loops.
 *
 * After the user completes sign-in in Safari, the IdP redirects to our
 * HTTPS Lambda callback, which does the token exchange + storage, then
 * 302s to `thinkwork://mcp-oauth-complete?status=success|error&...`.
 * iOS shows its "Open in Thinkwork?" prompt; on confirm, expo-router
 * lands here with the status. This screen just shows a brief state
 * and navigates back to the MCP servers list.
 */

export default function McpOAuthCompleteRoute() {
  const { status, reason } = useLocalSearchParams<{ status?: string; reason?: string }>();
  const router = useRouter();
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    if (status === "error") {
      console.warn("[mcp-oauth] server-side exchange failed:", reason);
      setError(
        reason === "token_exchange_failed"
          ? "Sign-in succeeded but the server couldn't finalize the connection."
          : "Sign-in failed. Please try again.",
      );
      return;
    }

    // Success (or missing status — treat absence as success on the
    // off-chance the Lambda omits it). Pop back to the MCP servers list.
    // Prefer `back` so we don't stack a redundant push when the user
    // started from the detail screen.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings/mcp-servers");
    }
  }, [status, reason, router]);

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950 gap-3 px-6">
      {error ? (
        <Text variant="muted" className="text-center">{error}</Text>
      ) : (
        <>
          <ActivityIndicator size="large" />
          <Text variant="muted">Finishing MCP connection…</Text>
        </>
      )}
    </View>
  );
}
