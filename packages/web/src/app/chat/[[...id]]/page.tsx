import ChatClient from "./chat-client";

// Generate static params for static export (Capacitor mobile builds)
// For optional catch-all routes, return empty array for the base /chat route
export function generateStaticParams() {
  return [{ id: [] }];
}

export default function ChatPage() {
  return <ChatClient />;
}
