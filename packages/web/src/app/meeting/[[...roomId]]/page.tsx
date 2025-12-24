import MeetingClient from "./meeting-client";

// Generate static params for static export (Capacitor mobile builds)
// For optional catch-all routes, return empty array for the base /meeting route
export function generateStaticParams() {
  return [{ roomId: [] }];
}

export default function MeetingPage() {
  return <MeetingClient />;
}
