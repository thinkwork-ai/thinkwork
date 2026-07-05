import { describe, expect, it } from "vitest";
import {
  applyVoiceInterim,
  initialVoiceDictationState,
  interruptVoiceHold,
  releaseVoiceHold,
  startVoiceHold,
} from "../voice-dictation-state";

describe("hold-to-talk voice dictation state", () => {
  it("commits final transcript on release without requesting send", () => {
    const recording = startVoiceHold(initialVoiceDictationState(), true);
    const released = releaseVoiceHold(recording, "Drafted voice text");

    expect(released).toMatchObject({
      recording: false,
      transcript: "Drafted voice text",
      sendRequested: false,
    });
  });

  it("preserves partial transcript when interrupted mid-recording", () => {
    const recording = startVoiceHold(initialVoiceDictationState(), true);
    const interim = applyVoiceInterim(recording, "Partial voice text");
    const interrupted = interruptVoiceHold(interim);

    expect(interrupted).toMatchObject({
      recording: false,
      transcript: "Partial voice text",
      sendRequested: false,
    });
  });

  it("shows fallback alert state instead of entering recording when speech is unavailable", () => {
    const state = startVoiceHold(initialVoiceDictationState(), false);

    expect(state).toMatchObject({
      recording: false,
      fallbackAlertShown: true,
    });
  });
});
