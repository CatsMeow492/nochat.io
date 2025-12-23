"use client";

import { useState, useCallback } from "react";
import { Search, User, Loader2, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
}

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateConversation: (participantIds: string[]) => void;
  isCreating?: boolean;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreateConversation,
  isCreating = false,
}: NewConversationDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchResult | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return;

    setIsSearching(true);
    setHasSearched(true);
    try {
      const response = await api.searchUsers(searchQuery.trim());
      setSearchResults(response.users || []);
    } catch (error) {
      console.error("Failed to search users:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSearching) {
      handleSearch();
    }
  };

  const handleSelectUser = (user: SearchResult) => {
    setSelectedUser(user);
  };

  const handleStartConversation = () => {
    if (selectedUser) {
      onCreateConversation([selectedUser.id]);
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setHasSearched(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="gradient-text">New Conversation</DialogTitle>
          <DialogDescription>
            Search for a user by email, username, or user ID to start a conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Email, username, or user ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-9"
                autoFocus
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={searchQuery.trim().length < 2 || isSearching}
              size="default"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {/* Search Results */}
          <div className="min-h-[200px] max-h-[300px] overflow-y-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
                      selectedUser?.id === user.id
                        ? "bg-primary/20 border border-primary/50"
                        : "hover:bg-secondary/50"
                    )}
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-primary/20 text-primary">
                        {user.display_name?.[0]?.toUpperCase() ||
                          user.username?.[0]?.toUpperCase() || (
                            <User className="w-4 h-4" />
                          )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {user.display_name || user.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        @{user.username}
                        {user.email && ` · ${user.email}`}
                      </p>
                    </div>
                    {selectedUser?.id === user.id && (
                      <div className="text-primary">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : hasSearched ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <User className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No users found matching &quot;{searchQuery}&quot;
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try searching by exact email or username
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Search className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Enter an email, username, or user ID
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum 2 characters required
                </p>
              </div>
            )}
          </div>

          {/* Action Button */}
          {selectedUser && (
            <Button
              onClick={handleStartConversation}
              disabled={isCreating}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting conversation...
                </>
              ) : (
                <>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Start conversation with {selectedUser.display_name || selectedUser.username}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
