import { Stack } from "expo-router";

export default function ThreadLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="conversation" />
      <Stack.Screen name="details" />
      <Stack.Screen name="documents" />
    </Stack>
  );
}
