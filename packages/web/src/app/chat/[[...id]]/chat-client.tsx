"use client";

import { useParams, useRouter } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";

export default function ChatClient() {
  const params = useParams();
  const router = useRouter();

  // Handle optional catch-all route - id can be undefined, string, or string[]
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  // No conversation ID - redirect to home or show chat list
  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold">No Conversation Selected</h1>
          <p className="text-muted-foreground">
            Please select a conversation from the sidebar.
          </p>
          <button
            onClick={() => router.push("/")}
            className="text-primary underline"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return <ChatView conversationId={id} />;
}
