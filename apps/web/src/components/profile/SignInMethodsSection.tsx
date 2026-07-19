import { useEffect, useState } from "react";
import { Badge, Button } from "@thinkwork/ui";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import {
  getActiveAuthClientId,
  getAuthOptionProviderSwitchUrl,
} from "@/lib/auth";
import {
  fetchPublicAuthOptions,
  type PublicOAuthOption,
} from "@/lib/auth-options";

export function SignInMethodsSection() {
  const [options, setOptions] = useState<PublicOAuthOption[] | null>(null);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeClientId = getActiveAuthClientId();

  useEffect(() => {
    let cancelled = false;
    void fetchPublicAuthOptions(fetch, "web").then((catalog) => {
      if (!cancelled) setOptions(catalog.oauthOptions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchProvider(option: PublicOAuthOption) {
    setError(null);
    setSwitchingKey(option.key);
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = await getAuthOptionProviderSwitchUrl(option, next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The sign-in provider could not be switched.",
      );
      setSwitchingKey(null);
    }
  }

  return (
    <div data-testid="sign-in-methods-section">
      <SettingsSection label="Sign-in methods">
        {options === null ? (
          <SettingsRow label="Loading sign-in methods..." />
        ) : options.length === 0 ? (
          <SettingsRow label="No federated sign-in methods are available." />
        ) : (
          options.map((option) => {
            const provider = providerLabel(option);
            const current = option.route.clientId === activeClientId;
            const switching = option.key === switchingKey;
            return (
              <SettingsRow
                key={option.key}
                label={provider}
                description={
                  current
                    ? `Your current session uses ${provider}.`
                    : `Use ${provider} for this ThinkWork account.`
                }
              >
                {current ? (
                  <Badge variant="secondary">Current session</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={switchingKey !== null}
                    onClick={() => void switchProvider(option)}
                  >
                    {switching ? `Opening ${provider}...` : `Switch to ${provider}`}
                  </Button>
                )}
              </SettingsRow>
            );
          })
        )}
      </SettingsSection>
      {error ? (
        <p role="alert" className="-mt-5 mb-8 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function providerLabel(option: PublicOAuthOption): string {
  return option.provider === "google" ? "Google" : "Microsoft";
}
