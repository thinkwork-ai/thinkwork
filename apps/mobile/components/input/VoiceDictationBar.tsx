import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Pressable, Animated, Alert } from "react-native";
import { X, CheckCircle } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

// Lazy-load expo-speech-recognition to avoid crash when native module isn't available
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = null;
let speechAvailable = false;

try {
  const mod = require("expo-speech-recognition");
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
  speechAvailable = !!ExpoSpeechRecognitionModule;
} catch {
  speechAvailable = false;
}

interface VoiceDictationBarProps {
  onTranscript: (text: string) => void;
  onInterim: (text: string) => void;
  onCancel: () => void;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
}

/** Check if speech recognition native module is available */
export function isSpeechAvailable(): boolean {
  return speechAvailable;
}

/** Animated waveform bars for visual feedback while recording */
function WaveformBars({ isDark }: { isDark: boolean }) {
  const bars = useRef(
    Array.from({ length: 7 }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    const animations = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.3 + Math.random() * 0.7,
            duration: 200 + Math.random() * 300,
            useNativeDriver: true,
            delay: i * 50,
          }),
          Animated.timing(bar, {
            toValue: 0.2 + Math.random() * 0.3,
            duration: 200 + Math.random() * 300,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);

  const barColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";

  return (
    <View className="flex-row items-center gap-0.5" style={{ height: 24 }}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            borderRadius: 1.5,
            backgroundColor: barColor,
            height: 24,
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  );
}

/** No-op placeholder hooks when native module isn't available */
function useNoopEvent(_event: string, _callback: any) {}

export function VoiceDictationBar({
  onTranscript,
  onInterim,
  onCancel,
  colors,
  isDark,
}: VoiceDictationBarProps) {
  const [seconds, setSeconds] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const transcriptRef = useRef("");

  const useEvent = speechAvailable ? useSpeechRecognitionEvent : useNoopEvent;

  // Timer
  useEffect(() => {
    if (!isListening) return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  // Speech recognition events
  useEvent("start", () => {
    setIsListening(true);
  });

  useEvent("result", (event: any) => {
    const text = event.results[0]?.transcript ?? "";
    transcriptRef.current = text;
    onInterim(text);
  });

  useEvent("end", () => {
    if (transcriptRef.current) {
      onTranscript(transcriptRef.current);
    } else {
      onCancel();
    }
  });

  useEvent("error", (event: any) => {
    console.warn("[VoiceDictation] Error:", event.error);
    onCancel();
  });

  // Start recognition on mount
  useEffect(() => {
    if (!speechAvailable) {
      Alert.alert(
        "Voice Input Unavailable",
        "A native app build is required for voice input. Please install the latest TestFlight build.",
      );
      onCancel();
      return;
    }

    let cancelled = false;

    async function start() {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          "Microphone Access Required",
          "Please enable microphone and speech recognition permissions in Settings to use voice input.",
        );
        onCancel();
        return;
      }
      if (cancelled) return;
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
      });
    }

    start();
    return () => {
      cancelled = true;
      if (speechAvailable) ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (speechAvailable) ExpoSpeechRecognitionModule.stop();
  }, []);

  const handleCancel = useCallback(() => {
    if (speechAvailable) ExpoSpeechRecognitionModule.abort();
    onCancel();
  }, [onCancel]);

  const timerText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <View className="flex-row items-center justify-between px-4 pt-1 pb-2">
      {/* Cancel */}
      <Pressable
        onPress={handleCancel}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isDark ? "#404040" : "#d4d4d4",
        }}
      >
        <X size={18} color={isDark ? "#e5e5e5" : "#404040"} />
      </Pressable>

      {/* Waveform + timer */}
      <View className="flex-row items-center gap-3">
        <WaveformBars isDark={isDark} />
        <Text className="text-sm font-mono" style={{ color: colors.mutedForeground }}>
          {timerText}
        </Text>
      </View>

      {/* Confirm */}
      <Pressable
        onPress={handleConfirm}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primary,
        }}
      >
        <CheckCircle size={20} color="#ffffff" />
      </Pressable>
    </View>
  );
}
