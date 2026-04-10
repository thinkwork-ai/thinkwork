import React from "react";
import { useColorScheme } from "react-native";

export function TypingIndicator({ inline }: { inline?: boolean }) {
  const colorScheme = useColorScheme();
  const dark = colorScheme === "dark";
  const dotStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: dark ? "#9ca3af" : "#737373",
    animationName: "typingPulse",
    animationDuration: "900ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  };

  const content = (
    <>
      <style>{`@keyframes typingPulse { 0%, 100% { opacity: 0.28; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-1px); } }`}</style>
      <div
        style={{
          background: dark ? "#262626" : "#f5f5f5",
          borderRadius: 16,
          borderBottomLeftRadius: 6,
          padding: "10px 14px",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ ...dotStyle, animationDelay: "0ms" }} />
        <span style={{ ...dotStyle, animationDelay: "140ms" }} />
        <span style={{ ...dotStyle, animationDelay: "280ms" }} />
      </div>
    </>
  );

  if (inline) return content;

  return (
    <div style={{ marginBottom: 12, paddingLeft: 16, paddingRight: 16, display: "flex", justifyContent: "flex-start" }}>
      {content}
    </div>
  );
}
