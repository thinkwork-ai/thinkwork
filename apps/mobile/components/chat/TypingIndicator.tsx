import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ShimmerText } from "@/components/ui/ShimmerText";

// "Working… 12s" — matches the desktop/web running indicator. The component
// mounts when the agent turn starts (gated by isThreadActive upstream) and
// unmounts when it settles, so its lifetime ≈ the turn duration.
function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

export function TypingIndicator({ inline }: { inline?: boolean }) {
  const start = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    start.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - start.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const label = elapsed > 0 ? `Working… ${formatElapsed(elapsed)}` : "Working…";

  const content = (
    <View className="px-4 py-2">
      <ShimmerText text={label} />
    </View>
  );

  if (inline) return content;

  return <View className="mb-3 px-4 items-start">{content}</View>;
}
