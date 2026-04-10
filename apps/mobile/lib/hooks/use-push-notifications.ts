/**
 * Push notification hook — handles permission, token registration,
 * foreground display, and deep link navigation on tap.
 *
 * Call once from the authenticated layout.
 */

import { useState, useEffect, useRef } from "react";
import { Platform, Alert } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useMutation } from "urql";
import { RegisterPushTokenMutation, UnregisterPushTokenMutation } from "@/lib/graphql-queries";

// Show notifications even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications(isAuthenticated: boolean) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const [, executeRegister] = useMutation(RegisterPushTokenMutation);
  const [, executeUnregister] = useMutation(UnregisterPushTokenMutation);

  useEffect(() => {
    // Skip on web and non-device environments (simulators may work with limitations)
    if (Platform.OS === "web" || !isAuthenticated) return;

    console.log("[push-notifications] Starting registration flow, isDevice:", Device.isDevice, "platform:", Platform.OS);

    registerForPushNotificationsAsync().then(async (token) => {
      console.log("[push-notifications] registerForPushNotificationsAsync returned:", token ? token.slice(0, 30) + "..." : "null");
      if (!token) return;
      setExpoPushToken(token);

      // Register token with backend
      const { error } = await executeRegister({
        input: { token, platform: Platform.OS },
      });
      if (error) {
        console.error("[push-notifications] Failed to register token:", error.message);
      } else {
        console.log("[push-notifications] Token registered with backend successfully");
      }
    }).catch((err) => {
      console.error("[push-notifications] Registration flow error:", err);
    });

    // Listen for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log("[push-notifications] Received:", notification.request.content.title);
    });

    // Listen for notification taps — navigate to thread
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      const content = response.notification.request.content;
      const trigger = response.notification.request.trigger as any;

      // content.data for Expo push, trigger.payload for raw APNs/simctl
      const threadId = content.data?.threadId ?? trigger?.payload?.threadId;
      if (threadId) {
        setTimeout(() => router.push(`/thread/${threadId}`), 500);
      }
    };

    responseListener.current = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    // Handle cold launch — check if the app was opened from a notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isAuthenticated]);

  const unregisterToken = async () => {
    if (!expoPushToken) return;
    await executeUnregister({ token: expoPushToken });
    setExpoPushToken(null);
  };

  return { expoPushToken, unregisterToken };
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  console.log("[push-notifications] Checking permissions...");

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  console.log("[push-notifications] Existing permission status:", existingStatus);

  // Request if not already granted
  if (existingStatus !== "granted") {
    console.log("[push-notifications] Requesting permissions...");
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    console.log("[push-notifications] Permission request result:", status);
  }

  if (finalStatus !== "granted") {
    console.warn("[push-notifications] Permission not granted, finalStatus:", finalStatus);
    return null;
  }

  // Set notification channel for Android
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // On simulators, we can receive local/simctl pushes but can't get an Expo push token.
  // Return null token — permissions are still granted so simctl pushes work.
  if (!Device.isDevice) {
    console.log("[push-notifications] Simulator detected — skipping token registration");
    return null;
  }

  // Get the Expo push token (physical devices only)
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  console.log("[push-notifications] EAS projectId:", projectId);
  if (!projectId) {
    console.error("[push-notifications] No EAS projectId found in app config");
    return null;
  }

  try {
    console.log("[push-notifications] Calling getExpoPushTokenAsync...");
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log("[push-notifications] Got token:", tokenData.data.slice(0, 30) + "...");
    return tokenData.data;
  } catch (err) {
    console.error("[push-notifications] getExpoPushTokenAsync failed:", err);
    return null;
  }
}
