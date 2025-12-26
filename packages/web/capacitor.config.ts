import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.nochat.app",
  appName: "NoChat",
  webDir: "out",
  server: {
    // For production, use bundled assets
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
      // Automatically scroll input into view when keyboard appears
      scrollBehavior: "native",
    },
    Haptics: {
      // Enable haptic feedback (default is enabled)
      enabled: true,
    },
  },
  ios: {
    contentInset: "automatic",
    scheme: "App",
    allowsLinkPreview: true,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#000000",
  },
};

export default config;
