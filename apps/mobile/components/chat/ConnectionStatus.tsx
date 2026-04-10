import React from "react";
import { View } from "react-native";
import type { ConnectionStatus as Status } from "@/hooks/useGatewayChat";

const dotColor: Record<Status, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  disconnected: "bg-red-500",
  error: "bg-red-500",
};

export function ConnectionStatus({ status }: { status: Status }) {
  return <View className={`w-2 h-2 rounded-full ${dotColor[status]}`} />;
}
