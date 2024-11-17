// @ts-nocheck // TODO: Remove
import "./index.css";

import React from "react";
import { Typography, Button, Box, CssBaseline } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import VideocamIcon from "@mui/icons-material/Videocam";
import ThreeBackground from "./Background";
import Logo from "./logo.svg";
import { Mic } from "@mui/icons-material";
import PNGBackground from "./ConfigureCall";
import BG from "./assets/static_background.png";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import theme from "./theme";
import Splash from "./pages/splash";
import CallConfigurations from "./pages/call_configurations";
import Call from "./pages/call";
import store from "./services/redux";
import queryClient from "./services/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { CallSettingsProvider } from "./context/provider";
import router from "./services/react-router";

function WrappedApp() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  );
}

function App() {
  return <RouterProvider router={router} />;
}

export default App;
