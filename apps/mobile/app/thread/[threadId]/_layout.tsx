import { Stack } from "expo-router";

export default function ThreadLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="info" />
    </Stack>
  );
}
