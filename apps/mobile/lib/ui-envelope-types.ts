/**
 * UI Action type — used by the GenUI onAction bridge.
 * ChatBubble.handleGenUIAction converts GenUIAction → UiAction
 * and ChatScreen.handleEnvelopeAction sends it as a system instruction.
 */

export interface UiAction {
  id?: string;
  label?: string;
  event?: 'click' | 'submit' | 'change';
  action: {
    type: 'tool.invoke' | 'navigate' | 'local.state.update';
    server?: string;
    tool?: string;
    args?: Record<string, unknown>;
    presetArgs?: Record<string, unknown>;
  };
  auth?: {
    requiresUserConfirmation?: boolean;
    requiredScopes?: string[];
  };
}
