"use client";

import { useState, useCallback } from "react";
import {
  Search,
  Link2,
  QrCode,
  Copy,
  Check,
  Loader2,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInvites, useContacts } from "@/hooks/use-contacts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const [activeTab, setActiveTab] = useState("search");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>
            Search for users, share an invite link, or scan a QR code
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="search" className="gap-2">
              <Search className="w-4 h-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="invite" className="gap-2">
              <Link2 className="w-4 h-4" />
              Invite Link
            </TabsTrigger>
            <TabsTrigger value="qr" className="gap-2">
              <QrCode className="w-4 h-4" />
              QR Code
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-4 mt-4">
            <SearchTab onSuccess={() => onOpenChange(false)} />
          </TabsContent>

          <TabsContent value="invite" className="space-y-4 mt-4">
            <InviteLinkTab />
          </TabsContent>

          <TabsContent value="qr" className="space-y-4 mt-4">
            <QRCodeTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SearchTab({ onSuccess }: { onSuccess: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const { sendRequest } = useContacts();

  const handleSearch = useCallback(async () => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }

    try {
      setSearching(true);
      const response = await api.searchUsers(query.trim(), 10);
      setResults(response.users);
    } catch (error) {
      console.error("Search failed:", error);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleSendRequest = async (userId: string) => {
    try {
      setSending(userId);
      await sendRequest(userId);
      setSent((prev) => new Set(prev).add(userId));
    } catch (error) {
      console.error("Failed to send request:", error);
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search by username or email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={searching}>
          {searching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </Button>
      </div>

      <div className="min-h-[200px]">
        {searching ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {query.length > 0 && query.length < 2
                ? "Enter at least 2 characters to search"
                : query.length >= 2
                ? "No users found"
                : "Search for users by username or email"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors"
              >
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {user.display_name?.[0]?.toUpperCase() ||
                      user.username?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {user.display_name || user.username}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    @{user.username}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={sent.has(user.id) ? "outline" : "default"}
                  onClick={() => handleSendRequest(user.id)}
                  disabled={sending === user.id || sent.has(user.id)}
                >
                  {sending === user.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : sent.has(user.id) ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Sent
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-1" />
                      Add
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteLinkTab() {
  const { invites, createInvite, deactivateInvite, loading } = useInvites();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState<string>("unlimited");
  const [expiresIn, setExpiresIn] = useState<string>("never");

  const handleCreateInvite = async () => {
    try {
      setCreating(true);
      const options: { max_uses?: number; expires_in?: number } = {};

      if (maxUses !== "unlimited") {
        options.max_uses = parseInt(maxUses);
      }

      if (expiresIn !== "never") {
        // Convert to seconds
        const expiresMap: Record<string, number> = {
          "1h": 3600,
          "24h": 86400,
          "7d": 604800,
          "30d": 2592000,
        };
        options.expires_in = expiresMap[expiresIn];
      }

      await createInvite(options);
    } catch (error) {
      console.error("Failed to create invite:", error);
    } finally {
      setCreating(false);
    }
  };

  const getInviteUrl = (code: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/${code}`;
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(getInviteUrl(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const activeInvites = invites.filter((i) => i.is_active);

  return (
    <div className="space-y-4">
      {/* Create new invite */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/30">
        <Label>Create a new invite link</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Max uses</Label>
            <Select value={maxUses} onValueChange={setMaxUses}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">Unlimited</SelectItem>
                <SelectItem value="1">1 use</SelectItem>
                <SelectItem value="5">5 uses</SelectItem>
                <SelectItem value="10">10 uses</SelectItem>
                <SelectItem value="25">25 uses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Expires</Label>
            <Select value={expiresIn} onValueChange={setExpiresIn}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="24h">24 hours</SelectItem>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={handleCreateInvite}
          disabled={creating}
          className="w-full"
        >
          {creating ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Link2 className="w-4 h-4 mr-2" />
          )}
          Generate Link
        </Button>
      </div>

      {/* Existing invites */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeInvites.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No active invite links
        </p>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Active links</Label>
          {activeInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30"
            >
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{invite.code}</p>
                <p className="text-xs text-muted-foreground">
                  {invite.max_uses
                    ? `${invite.use_count}/${invite.max_uses} uses`
                    : `${invite.use_count} uses`}
                  {invite.expires_at && (
                    <> &middot; Expires {new Date(invite.expires_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(invite.code)}
              >
                {copied === invite.code ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => deactivateInvite(invite.id)}
              >
                &times;
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QRCodeTab() {
  const { invites, createInvite, loading } = useInvites();
  const [generating, setGenerating] = useState(false);

  // Get or create a QR-specific invite
  const qrInvite = invites.find((i) => i.is_active && !i.max_uses && !i.expires_at);

  const handleGenerateQR = async () => {
    try {
      setGenerating(true);
      await createInvite(); // Unlimited, never expires
    } catch (error) {
      console.error("Failed to create QR invite:", error);
    } finally {
      setGenerating(false);
    }
  };

  const getInviteUrl = (code: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/${code}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!qrInvite) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <QrCode className="w-12 h-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          Generate a QR code that others can scan to add you as a contact
        </p>
        <Button onClick={handleGenerateQR} disabled={generating}>
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <QrCode className="w-4 h-4 mr-2" />
          )}
          Generate QR Code
        </Button>
      </div>
    );
  }

  // Simple QR code using a free API (in production, use a proper library)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    getInviteUrl(qrInvite.code)
  )}`;

  return (
    <div className="flex flex-col items-center space-y-4 py-4">
      <div className="p-4 bg-white rounded-xl">
        <img
          src={qrUrl}
          alt="QR Code"
          width={200}
          height={200}
          className="rounded"
        />
      </div>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        Scan this QR code with another device to add you as a contact
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(qrUrl, "_blank")}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Download
        </Button>
      </div>
    </div>
  );
}
