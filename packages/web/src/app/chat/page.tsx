"use client";

import { MessageSquare, Plus, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversations } from "@/hooks";
import { useAuthStore } from "@/stores";


export default function ChatHomePage() {
  const { createConversation, isCreating } = useConversations();
  const { user } = useAuthStore();
  const isAnonymous = user?.isAnonymous;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <MessageSquare className="w-8 h-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">
            {isAnonymous ? "Welcome, Anonymous User" : "Welcome to NoChat"}
          </h2>
          <p className="text-muted-foreground">
            {isAnonymous
              ? "You are currently in a temporary session. Start a chat to generate an invite link."
              : "Select a conversation from the sidebar or start a new one to begin secure messaging."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button
            onClick={() => createConversation({ type: "direct" })}
            disabled={isCreating}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            {isAnonymous ? "Start New Chat" : "New Chat"}
          </Button>
          {!isAnonymous && (
            <Button variant="outline" className="gap-2">
              <Video className="w-4 h-4" />
              Start Video Call
            </Button>
          )}
        </div>

        <div className="pt-8 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {isAnonymous
              ? "Your session and keys will be lost if you clear your browser data. Create an account to save your identity."
              : "All messages are end-to-end encrypted with post-quantum cryptography. Your keys never leave your device."}
          </p>
        </div>
      </div>
    </div>
  );
}
