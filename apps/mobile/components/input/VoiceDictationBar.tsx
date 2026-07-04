import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import { View, Animated, Alert, AppState } from "react-native";
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
  onListeningChange?: (listening: boolean) => void;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
}

export interface VoiceDictationBarRef {
  start: () => Promise<boolean>;
  stop: () => void;
  cancel: () => void;
}

/** Check if speech recognition native module is available */
export function isSpeechAvailable(): boolean {
  return speechAvailable;
}

/** Animated waveform bars for visual feedback while recording */
export function WaveformBars({ isDark }: { isDark: boolean }) {
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

export const VoiceDictationBar = forwardRef<
  VoiceDictationBarRef,
  VoiceDictationBarProps
>(function VoiceDictationBar(
  { onTranscript, onInterim, onCancel, onListeningChange, colors, isDark },
  ref,
) {
  const [seconds, setSeconds] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const transcriptRef = useRef("");
  const committedRef = useRef(false);

  const useEvent = speechAvailable ? useSpeechRecognitionEvent : useNoopEvent;

  const setListening = useCallback(
    (listening: boolean) => {
      setIsListening(listening);
      onListeningChange?.(listening);
      if (!listening) setSeconds(0);
    },
    [onListeningChange],
  );

  // Timer
  useEffect(() => {
    if (!isListening) return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  // Speech recognition events
  useEvent("start", () => {
    setListening(true);
  });

  useEvent("result", (event: any) => {
    const text = event.results[0]?.transcript ?? "";
    transcriptRef.current = text;
    onInterim(text);
  });

  useEvent("end", () => {
    if (committedRef.current) {
      setListening(false);
      return;
    }
    if (transcriptRef.current) {
      committedRef.current = true;
      onTranscript(transcriptRef.current);
    } else {
      onCancel();
    }
    setListening(false);
  });

  useEvent("error", (event: any) => {
    console.warn("[VoiceDictation] Error:", event.error);
    setListening(false);
    onCancel();
  });

  const commitTranscript = useCallback(() => {
    if (committedRef.current) return;
    if (transcriptRef.current) {
      committedRef.current = true;
      onTranscript(transcriptRef.current);
    } else {
      onCancel();
    }
  }, [onCancel, onTranscript]);

  const start = useCallback(async () => {
    if (!speechAvailable) {
      Alert.alert(
        "Voice Input Unavailable",
        "A native app build is required for voice input. Please install the latest TestFlight build.",
      );
      onCancel();
      return false;
    }

    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        "Microphone Access Required",
        "Please enable microphone and speech recognition permissions in Settings to use voice input.",
      );
      onCancel();
      return false;
    }

    transcriptRef.current = "";
    committedRef.current = false;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
    });
    return true;
  }, [onCancel, setListening]);

  const stop = useCallback(() => {
    if (!speechAvailable || !isListening) return;
    commitTranscript();
    setListening(false);
    ExpoSpeechRecognitionModule.stop();
  }, [commitTranscript, isListening, setListening]);

  const cancel = useCallback(() => {
    if (speechAvailable && isListening) ExpoSpeechRecognitionModule.abort();
    setListening(false);
    onCancel();
  }, [isListening, onCancel, setListening]);

  useImperativeHandle(ref, () => ({ start, stop, cancel }), [
    cancel,
    start,
    stop,
  ]);

  useEffect(() => {
    return () => {
      if (speechAvailable) ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (isListening && (nextState === "background" || nextState === "inactive")) {
        stop();
      }
    });
    return () => sub.remove();
  }, [isListening, stop]);

  const timerText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (!isListening) return null;

  return (
    <View className="flex-row items-center gap-2">
      <WaveformBars isDark={isDark} />
      <Text
        className="text-xs font-mono"
        style={{ color: colors.mutedForeground }}
      >
        {timerText}
      </Text>
    </View>
  );
});
