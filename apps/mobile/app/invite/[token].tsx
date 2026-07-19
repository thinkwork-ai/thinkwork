import { useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { H2, Muted, Text } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import { getPlatformConfig } from "@/lib/platform-config";

type EnrollmentOutcome =
  | "consumed"
  | "invalid_grant"
  | "invalid_challenge"
  | "expired"
  | "already_consumed"
  | "wrong_route"
  | "wrong_redirect"
  | "identity_conflict";

export default function AcceptInvitationScreen() {
  const router = useRouter();
  const { token = "" } = useLocalSearchParams<{ token?: string }>();
  const { isAuthenticated, isLoading, getToken, retryBootstrap } = useAuth();
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnPath = `/invite/${encodeURIComponent(token)}`;

  async function consumeEnrollment() {
    setError(null);
    setSubmitting(true);
    try {
      const idToken = await getToken();
      if (!idToken) throw new Error("Sign in before accepting the invitation.");
      const apiUrl = getPlatformConfig().apiUrl?.replace(/\/+$/, "");
      if (!apiUrl) throw new Error("Deployment API is not configured.");
      const response = await fetch(`${apiUrl}/api/auth/enrollment/consume`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          startToken: token,
          recipientChallenge: challenge,
          redirectUri: "thinkwork://auth/callback",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        outcome?: EnrollmentOutcome;
      };
      if (body.outcome === "consumed" || body.outcome === "already_consumed") {
        await retryBootstrap();
        router.replace("/" as never);
        return;
      }
      setError(enrollmentOutcomeMessage(body.outcome));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The invitation could not be accepted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-white p-4 dark:bg-neutral-950">
      <Card className="w-full max-w-md self-center">
        <CardHeader className="items-center pb-4">
          <Image
            source={require("@/assets/logo.png")}
            style={{ width: 80, height: 64 }}
            resizeMode="contain"
          />
          <H2 className="text-center">Accept your invitation</H2>
          <Muted className="text-center">
            Sign in with the identity you want to use, then enter the one-time
            code from your invitation email.
          </Muted>
        </CardHeader>
        <CardContent className="gap-4">
          {!token ? (
            <Text size="sm" className="text-center text-destructive">
              This invitation link is incomplete. Ask your workspace admin to
              resend it.
            </Text>
          ) : !isAuthenticated ? (
            <Button
              onPress={() =>
                router.push(
                  `/sign-in?next=${encodeURIComponent(returnPath)}` as never,
                )
              }
            >
              Continue to sign in
            </Button>
          ) : (
            <>
              <Input
                label="Enrollment code"
                value={challenge}
                onChangeText={(value) =>
                  setChallenge(value.replace(/\D/g, "").slice(0, 8))
                }
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={8}
                editable={!submitting}
              />
              {error && (
                <Text size="sm" className="text-center text-destructive">
                  {error}
                </Text>
              )}
              <Button
                onPress={consumeEnrollment}
                loading={submitting}
                disabled={submitting || challenge.length !== 8}
              >
                Accept invitation
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </SafeAreaView>
  );
}

export function enrollmentOutcomeMessage(
  outcome: EnrollmentOutcome | undefined,
): string {
  switch (outcome) {
    case "invalid_challenge":
      return "That enrollment code is not valid.";
    case "expired":
      return "This invitation has expired. Ask your workspace admin to resend it.";
    case "wrong_route":
      return "This sign-in method is not allowed for the invitation.";
    case "wrong_redirect":
      return "This invitation must be completed from its original ThinkWork environment.";
    case "identity_conflict":
      return "This sign-in identity is already attached to another ThinkWork user.";
    case "invalid_grant":
      return "This invitation is invalid or has been replaced.";
    case "already_consumed":
      return "This invitation has already been accepted.";
    case "consumed":
      return "Invitation accepted.";
    default:
      return "The invitation could not be accepted.";
  }
}
