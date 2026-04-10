import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

const SHIMMER_TEXT = "Processing...";
const SHIMMER_WINDOW = 3;
const CHAR_DURATION = 120;
const TOTAL_STEPS = SHIMMER_TEXT.length + SHIMMER_WINDOW;

function AnimatedChar({ char, index, step }: { char: string; index: number; step: Animated.Value }) {
  const color = step.interpolate({
    inputRange: [index, index + SHIMMER_WINDOW / 2, index + SHIMMER_WINDOW],
    outputRange: ["#6b7280", "#d1d5db", "#6b7280"],
    extrapolate: "clamp",
  });
  return <Animated.Text style={{ color, fontSize: 14, lineHeight: 18 }}>{char}</Animated.Text>;
}

export function TypingIndicator({ inline }: { inline?: boolean }) {
  const step = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(step, {
        toValue: TOTAL_STEPS,
        duration: CHAR_DURATION * TOTAL_STEPS,
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [step]);

  const content = (
    <View className="px-4 py-2">
      <Animated.Text style={{ fontSize: 14, lineHeight: 18 }}>
        {SHIMMER_TEXT.split("").map((char, i) => (
          <AnimatedChar key={i} char={char} index={i} step={step} />
        ))}
      </Animated.Text>
    </View>
  );

  if (inline) return content;

  return (
    <View className="mb-3 px-4 items-start">
      {content}
    </View>
  );
}
