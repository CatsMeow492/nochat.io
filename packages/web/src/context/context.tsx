import React, { createContext, useReducer, useContext } from 'react';

/**
 * Interface representing a media device (camera or microphone)
 */
export interface Device {
  deviceId: string;
  label: string;
}

/**
 * Enum representing the intent of the call (starting a new call or joining an existing one)
 */
export enum CallIntent {
  Start,
  Join,
}

export interface CallSettingsState {
  videoDevices: Device[];
  audioDevices: Device[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  isMuted: boolean;
  isVideoOn: boolean;
  callIntent: CallIntent;
}

export type CallSettingsAction =
  | { type: 'SET_VIDEO_DEVICES'; payload: Device[] }
  | { type: 'SET_AUDIO_DEVICES'; payload: Device[] }
  | { type: 'SET_SELECTED_VIDEO_DEVICE'; payload: string }
  | { type: 'SET_SELECTED_AUDIO_DEVICE'; payload: string }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_VIDEO' }
  | { type: 'SET_CALL_INTENT'; payload: CallIntent };

export const initialState: CallSettingsState = {
  videoDevices: [],
  audioDevices: [],
  selectedVideoDevice: '',
  selectedAudioDevice: '',
  isMuted: false,
  isVideoOn: true,
  callIntent: CallIntent.Join,
};

const CallSettingsContext = createContext<{
  state: CallSettingsState;
  dispatch: React.Dispatch<CallSettingsAction>;
} | undefined>(undefined);

export function callSettingsReducer(state: CallSettingsState, action: CallSettingsAction): CallSettingsState {
  switch (action.type) {
    case 'SET_VIDEO_DEVICES':
      return { ...state, videoDevices: action.payload };
    case 'SET_AUDIO_DEVICES':
      return { ...state, audioDevices: action.payload };
    case 'SET_SELECTED_VIDEO_DEVICE':
      return { ...state, selectedVideoDevice: action.payload };
    case 'SET_SELECTED_AUDIO_DEVICE':
      return { ...state, selectedAudioDevice: action.payload };
    case 'TOGGLE_MUTE':
      return { ...state, isMuted: !state.isMuted };
    case 'TOGGLE_VIDEO':
      return { ...state, isVideoOn: !state.isVideoOn };
    case 'SET_CALL_INTENT':
      return { ...state, callIntent: action.payload };
    default:
      return state;
  }
}

export default CallSettingsContext