"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  MessageSquare,
  Plus,
  Settings,
  LogOut,
  Shield,
  User,
  Search,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth, useConversations } from "@/hooks";
import { useCryptoStore } from "@/stores";
import { cn } from "@/lib/utils";

function SidebarContent() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { conversations, isLoading, createConversation, isCreating } =
    useConversations();
  const { status: encryptionStatus, identityFingerprint } = useCryptoStore();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = conversations.filter((conv: any) => {
    if (!searchQuery) return true;
    const name = conv.name || "Unnamed Chat";
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getEncryptionStatusColor = () => {
    switch (encryptionStatus) {
      case "encrypted":
        return "text-green-500";
      case "error":
        return "text-destructive";
      case "establishing":
      case "initializing":
        return "text-yellow-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold gradient-text">NoChat</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <Shield className={cn("w-4 h-4", getEncryptionStatusColor())} />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {encryptionStatus === "encrypted"
                  ? "End-to-end encrypted"
                  : encryptionStatus === "error"
                  ? "Encryption error"
                  : "Setting up encryption..."}
              </p>
              {identityFingerprint && (
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  Key: {identityFingerprint.slice(0, 16)}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary/50 border-border"
          />
        </div>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="p-2">
          {/* New Chat Button */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 mb-2 text-muted-foreground hover:text-foreground"
            onClick={() => createConversation({ type: "direct" })}
            disabled={isCreating}
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </Button>

          <Separator className="my-2" />

          {/* Conversation Items */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {searchQuery
                ? "No conversations found"
                : "No conversations yet"}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conversation: any) => {
                const isActive = pathname === `/chat/${conversation.id}`;
                return (
                  <button
                    key={conversation.id}
                    onClick={() => router.push(`/chat/${conversation.id}`)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-primary/20 text-primary">
                        {conversation.name?.[0]?.toUpperCase() || "C"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">
                          {conversation.name || "Unnamed Chat"}
                        </p>
                        {conversation.unreadCount > 0 && (
                          <Badge
                            variant="default"
                            className="ml-2 h-5 min-w-[20px] px-1.5"
                          >
                            {conversation.unreadCount}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {conversation.lastMessage || "No messages yet"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* User Section */}
      <div className="p-4 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="bg-primary/20 text-primary">
                  {user?.username?.[0]?.toUpperCase() || (
                    <User className="w-4 h-4" />
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.username || "Anonymous"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.isAnonymous ? "Anonymous user" : user?.email}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function ChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-80 border-r border-border bg-sidebar flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <div className="md:hidden fixed top-4 left-4 z-50">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="glass">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0 bg-sidebar">
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
