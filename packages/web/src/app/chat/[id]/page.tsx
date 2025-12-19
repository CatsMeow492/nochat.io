"use client";

import { use } from "react";
import { ChatView } from "@/components/chat/chat-view";

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const { id } = use(params);

  return <ChatView conversationId={id} />;
}
