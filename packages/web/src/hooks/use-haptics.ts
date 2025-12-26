"use client";

import { useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

/**
 * Hook for native haptic feedback on iOS/Android
 * Falls back gracefully to no-op on web
 */
export function useHaptics() {
  const isNative = Capacitor.isNativePlatform();

  /**
   * Light impact - for button taps, selections
   */
  const lightImpact = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.warn("[Haptics] Light impact failed:", error);
    }
  }, [isNative]);

  /**
   * Medium impact - for confirmations, toggles
   */
  const mediumImpact = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.warn("[Haptics] Medium impact failed:", error);
    }
  }, [isNative]);

  /**
   * Heavy impact - for important actions
   */
  const heavyImpact = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (error) {
      console.warn("[Haptics] Heavy impact failed:", error);
    }
  }, [isNative]);

  /**
   * Success notification - for successful actions like message sent
   */
  const successNotification = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (error) {
      console.warn("[Haptics] Success notification failed:", error);
    }
  }, [isNative]);

  /**
   * Warning notification - for warnings
   */
  const warningNotification = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch (error) {
      console.warn("[Haptics] Warning notification failed:", error);
    }
  }, [isNative]);

  /**
   * Error notification - for errors
   */
  const errorNotification = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch (error) {
      console.warn("[Haptics] Error notification failed:", error);
    }
  }, [isNative]);

  /**
   * Selection changed - for picker/scroll selections
   */
  const selectionChanged = useCallback(async () => {
    if (!isNative) return;
    try {
      await Haptics.selectionChanged();
    } catch (error) {
      console.warn("[Haptics] Selection changed failed:", error);
    }
  }, [isNative]);

  /**
   * Vibrate - generic vibration (fallback for older devices)
   */
  const vibrate = useCallback(async (duration: number = 300) => {
    if (!isNative) return;
    try {
      await Haptics.vibrate({ duration });
    } catch (error) {
      console.warn("[Haptics] Vibrate failed:", error);
    }
  }, [isNative]);

  return {
    isNative,
    lightImpact,
    mediumImpact,
    heavyImpact,
    successNotification,
    warningNotification,
    errorNotification,
    selectionChanged,
    vibrate,
  };
}
