/**
 * Compatibility-only Cognito pre-sign-up trigger.
 *
 * Native Google and Microsoft identities intentionally remain separate
 * Cognito principals. ThinkWork binds them many-to-one through the proven
 * user_auth_identities record after authentication. This trigger therefore
 * performs no email lookup, account creation, password mutation, or Cognito
 * identity linking. It remains as an inert artifact only while older deployed
 * pools still reference the historical trigger; U10 removes that wiring.
 */

interface PreSignUpEvent {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes: Record<string, string>;
  };
  response: {
    autoConfirmUser: boolean;
    autoVerifyEmail: boolean;
    autoVerifyPhone: boolean;
  };
}

export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  return event;
}
