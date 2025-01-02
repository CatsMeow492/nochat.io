import { createBrowserRouter } from "react-router-dom";
import Splash from "../pages/splash";
import { CallSettingsProvider } from "../context/provider";
import CallConfigurations from "../pages/call_configurations";
import Call from "../pages/call";
import RedirectToJoin from "../components/RedirectToJoin";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Splash />,
  },
  {
    path: "/join",
    element: (
      <CallSettingsProvider>
        <CallConfigurations />
      </CallSettingsProvider>
    ),
  },
  {
    path: "/call/:roomId",
    element: (
      <CallSettingsProvider>
        <RedirectToJoin />
      </CallSettingsProvider>
    ),
  },
  {
    path: "/call/:roomId/active",
    element: (
      <CallSettingsProvider>
        <Call />
      </CallSettingsProvider>
    ),
  },
]);

export default router;
