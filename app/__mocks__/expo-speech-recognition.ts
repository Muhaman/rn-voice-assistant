import { useEffect } from "react";

type Payload = Record<string, unknown>;

const listeners = new Map<string, (event: Payload) => void>();

export const ExpoSpeechRecognitionModule = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  supportsOnDeviceRecognition: jest.fn(() => false),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
};

export function useSpeechRecognitionEvent(name: string, listener: (event: Payload) => void) {
  useEffect(() => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  });
}

/** Test helper: deliver a native recognizer event to the mounted hook. */
export function emitSpeechEvent(name: string, payload: Payload = {}) {
  listeners.get(name)?.(payload);
}
