import { useState, useEffect, useCallback } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import * as Device from "expo-device";

const BIOMETRIC_ENABLED_KEY = "biometric_auth_enabled";
const STORED_EMAIL_KEY = "biometric_stored_email";
const STORED_PASSWORD_KEY = "biometric_stored_password";

export type BiometricType = "fingerprint" | "facial" | "iris" | "none";

interface BiometricState {
  isSupported: boolean;
  isEnabled: boolean;
  hasStoredCredentials: boolean;
  biometricType: BiometricType;
  isLoading: boolean;
}

export function useBiometricAuth() {
  const [state, setState] = useState<BiometricState>({
    isSupported: false,
    isEnabled: false,
    hasStoredCredentials: false,
    biometricType: "none",
    isLoading: true,
  });

  // Check device capabilities and stored preference on mount
  useEffect(() => {
    async function init() {
      // Skip on web
      if (Platform.OS === "web") {
        setState((s) => ({ ...s, isLoading: false }));
        return;
      }

      try {
        // Check if hardware supports biometrics
        // Only support biometric on real devices (not simulator/emulator)
        const isSimulator = !Device.isDevice;
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const isSupported = compatible && enrolled && !isSimulator;

        // Get biometric type
        let biometricType: BiometricType = "none";
        if (isSupported) {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            biometricType = "facial";
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            biometricType = "fingerprint";
          } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
            biometricType = "iris";
          }
        }

        // Check if user has enabled biometric auth
        const enabledStr = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        const isEnabled = enabledStr === "true";

        // Check if we have stored credentials
        const storedEmail = await SecureStore.getItemAsync(STORED_EMAIL_KEY);
        const hasStoredCredentials = !!storedEmail;

        setState({
          isSupported,
          isEnabled,
          hasStoredCredentials,
          biometricType,
          isLoading: false,
        });
      } catch (error) {
        console.error("Error initializing biometric auth:", error);
        setState((s) => ({ ...s, isLoading: false }));
      }
    }

    init();
  }, []);

  // Enable biometric auth and store credentials
  const enableBiometric = useCallback(async (email?: string, password?: string): Promise<boolean> => {
    if (!state.isSupported) return false;

    try {
      // Verify with biometric first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify your identity",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });

      if (result.success) {
        await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
        
        // Store credentials if provided
        if (email && password) {
          await SecureStore.setItemAsync(STORED_EMAIL_KEY, email);
          await SecureStore.setItemAsync(STORED_PASSWORD_KEY, password);
          setState((s) => ({ ...s, isEnabled: true, hasStoredCredentials: true }));
        } else {
          setState((s) => ({ ...s, isEnabled: true }));
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error enabling biometric:", error);
      return false;
    }
  }, [state.isSupported]);

  // Disable biometric auth and clear stored credentials
  const disableBiometric = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
      await SecureStore.deleteItemAsync(STORED_EMAIL_KEY);
      await SecureStore.deleteItemAsync(STORED_PASSWORD_KEY);
      setState((s) => ({ ...s, isEnabled: false, hasStoredCredentials: false }));
    } catch (error) {
      console.error("Error disabling biometric:", error);
    }
  }, []);

  // Authenticate with biometric (for app unlock)
  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) return false;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: getBiometricPrompt(state.biometricType),
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });

      return result.success;
    } catch (error) {
      console.error("Error authenticating:", error);
      return false;
    }
  }, [state.isSupported, state.biometricType]);

  // Get stored credentials after biometric auth (for login)
  const getStoredCredentials = useCallback(async (): Promise<{ email: string; password: string } | null> => {
    if (!state.isSupported || !state.hasStoredCredentials) return null;

    try {
      // Authenticate first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Sign in with ${getBiometricName(state.biometricType)}`,
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });

      if (result.success) {
        const email = await SecureStore.getItemAsync(STORED_EMAIL_KEY);
        const password = await SecureStore.getItemAsync(STORED_PASSWORD_KEY);
        
        if (email && password) {
          return { email, password };
        }
      }
      return null;
    } catch (error) {
      console.error("Error getting stored credentials:", error);
      return null;
    }
  }, [state.isSupported, state.hasStoredCredentials, state.biometricType]);

  // Refresh stored credentials check
  const refreshCredentialsCheck = useCallback(async () => {
    if (Platform.OS === "web") return;

    const storedEmail = await SecureStore.getItemAsync(STORED_EMAIL_KEY);
    setState((s) => ({ ...s, hasStoredCredentials: !!storedEmail }));
  }, []);

  // Store credentials without enabling biometric (called during sign-in,
  // before the enable prompt shows in _layout after navigation)
  const storeCredentials = useCallback(async (email: string, password: string) => {
    await SecureStore.setItemAsync(STORED_EMAIL_KEY, email);
    await SecureStore.setItemAsync(STORED_PASSWORD_KEY, password);
    setState((s) => ({ ...s, hasStoredCredentials: true }));
  }, []);

  // Just flip the enabled flag (credentials already stored by storeCredentials)
  const enableBiometricFlag = useCallback(async () => {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
    setState((s) => ({ ...s, isEnabled: true }));
  }, []);

  // Remove stored credentials without disabling (for when user declines prompt)
  const clearStoredCredentials = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORED_EMAIL_KEY);
    await SecureStore.deleteItemAsync(STORED_PASSWORD_KEY);
    setState((s) => ({ ...s, hasStoredCredentials: false }));
  }, []);

  return {
    ...state,
    enableBiometric,
    disableBiometric,
    authenticate,
    getStoredCredentials,
    refreshCredentialsCheck,
    storeCredentials,
    enableBiometricFlag,
    clearStoredCredentials,
  };
}

// Helper to get user-friendly biometric name
export function getBiometricName(type: BiometricType): string {
  switch (type) {
    case "facial":
      return Platform.OS === "ios" ? "Face ID" : "Face Recognition";
    case "fingerprint":
      return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    case "iris":
      return "Iris Scan";
    default:
      return "Biometric";
  }
}

function getBiometricPrompt(type: BiometricType): string {
  const name = getBiometricName(type);
  return `Sign in with ${name}`;
}
