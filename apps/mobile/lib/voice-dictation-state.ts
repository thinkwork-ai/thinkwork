export interface VoiceDictationState {
  recording: boolean;
  transcript: string;
  sendRequested: boolean;
  fallbackAlertShown: boolean;
}

export function initialVoiceDictationState(): VoiceDictationState {
  return {
    recording: false,
    transcript: "",
    sendRequested: false,
    fallbackAlertShown: false,
  };
}

export function startVoiceHold(
  state: VoiceDictationState,
  speechAvailable: boolean,
): VoiceDictationState {
  if (!speechAvailable) {
    return {
      ...state,
      recording: false,
      fallbackAlertShown: true,
    };
  }
  return {
    ...state,
    recording: true,
  };
}

export function applyVoiceInterim(
  state: VoiceDictationState,
  transcript: string,
): VoiceDictationState {
  return {
    ...state,
    transcript,
  };
}

export function releaseVoiceHold(
  state: VoiceDictationState,
  finalTranscript: string,
): VoiceDictationState {
  return {
    ...state,
    recording: false,
    transcript: finalTranscript,
    sendRequested: false,
  };
}

export function interruptVoiceHold(
  state: VoiceDictationState,
): VoiceDictationState {
  return {
    ...state,
    recording: false,
    sendRequested: false,
  };
}
