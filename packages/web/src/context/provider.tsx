import { useContext, useReducer } from "react";
import CallSettingsContext, { callSettingsReducer, initialState } from "./context";

export function CallSettingsProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(callSettingsReducer, initialState);
    return (
      <CallSettingsContext.Provider value={{ state, dispatch }}>
        {children}
      </CallSettingsContext.Provider>
    );
  }
  
  export function useCallSettings() {
    const context = useContext(CallSettingsContext);
    if (context === undefined) {
      throw new Error('useCallSettings must be used within a CallSettingsProvider');
    }
    return context;
  }