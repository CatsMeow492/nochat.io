"use client";

import { useState } from "react";
import {
  Smartphone,
  Users,
  RefreshCw,
  UserPlus,
  Loader2,
  AlertCircle,
  CheckCircle,
  Trash2,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useContactSync,
  usePhoneVerification,
  type DiscoveredContact,
} from "@/hooks/use-contact-sync";
import { useContacts } from "@/hooks/use-contacts";
import { cn } from "@/lib/utils";

export function DiscoveredContacts() {
  const { status: phoneStatus, loading: phoneLoading } = usePhoneVerification();
  const {
    discovered,
    syncing,
    loading,
    error,
    isMobile,
    permissionStatus,
    syncContacts,
    clearHashes,
  } = useContactSync();
  const { sendRequest } = useContacts();

  const [syncResult, setSyncResult] = useState<{
    total: number;
    matches: number;
  } | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [addingContact, setAddingContact] = useState<string | null>(null);

  const handleSync = async () => {
    try {
      const result = await syncContacts();
      if (result) {
        setSyncResult({
          total: result.total_uploaded,
          matches: result.matches_found,
        });
      }
    } catch (err) {
      // Error is handled by the hook
    }
  };

  const handleClearHashes = async () => {
    await clearHashes();
    setSyncResult(null);
    setClearConfirmOpen(false);
  };

  const handleAddContact = async (userId: string) => {
    try {
      setAddingContact(userId);
      await sendRequest(userId);
    } catch (err) {
      // Error handling
    } finally {
      setAddingContact(null);
    }
  };

  // Loading state
  if (loading || phoneLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Phone not verified
  if (!phoneStatus?.phone_verified) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-amber-500/10">
              <Phone className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-base">Contact Discovery</CardTitle>
              <CardDescription>
                Verify your phone number to discover contacts
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Verify your phone number first to use contact discovery. This allows you
            to find which of your phone contacts are already on NoChat.
          </p>
          <Button variant="outline" className="w-full" asChild>
            <a href="/settings#phone">
              <Phone className="w-4 h-4 mr-2" />
              Verify Phone Number
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not on mobile platform
  if (!isMobile) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Smartphone className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Contact Discovery</CardTitle>
              <CardDescription>
                Sync your phone contacts to find friends
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-6 text-center">
            <div className="p-3 rounded-full bg-secondary mb-4">
              <Smartphone className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium mb-2">Available on Mobile Only</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Contact sync requires access to your phone's contact list. Open NoChat
              on your mobile device to discover friends.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Permission denied
  if (permissionStatus === "denied") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-base">Permission Required</CardTitle>
              <CardDescription>
                Contact access was denied
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            To discover contacts, please allow NoChat to access your contacts in your
            device settings.
          </p>
          <Button variant="outline" className="w-full" onClick={handleSync}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Discover Contacts</CardTitle>
              <CardDescription>
                Find friends who are on NoChat
              </CardDescription>
            </div>
          </div>
          {discovered.length > 0 && (
            <Badge variant="secondary">{discovered.length} found</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sync Result */}
        {syncResult && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <p className="text-sm">
              Synced {syncResult.total} contacts, found {syncResult.matches} on NoChat
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <p className="text-sm">{error.message}</p>
          </div>
        )}

        {/* Discovered Contacts List */}
        {discovered.length > 0 ? (
          <div className="space-y-2">
            {discovered.map((contact) => (
              <DiscoveredContactCard
                key={contact.user_id}
                contact={contact}
                onAdd={() => handleAddContact(contact.user_id)}
                adding={addingContact === contact.user_id}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="p-3 rounded-full bg-secondary mb-4">
              <Users className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium mb-2">No contacts found</h3>
            <p className="text-sm text-muted-foreground max-w-xs mb-4">
              {syncResult
                ? "None of your contacts are on NoChat yet. Invite them!"
                : "Sync your contacts to discover friends on NoChat"}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {syncResult ? "Sync Again" : "Sync Contacts"}
              </>
            )}
          </Button>
          {syncResult && (
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(true)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Privacy Notice */}
        <p className="text-xs text-muted-foreground text-center">
          Your contacts are hashed for privacy. We never see or store the actual
          phone numbers.
        </p>
      </CardContent>

      {/* Clear Confirmation */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Contact Data</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all synced contact hashes from our servers. You won't
              receive notifications when contacts join NoChat until you sync again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearHashes}>
              Clear Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DiscoveredContactCard({
  contact,
  onAdd,
  adding,
}: {
  contact: DiscoveredContact;
  onAdd: () => void;
  adding: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
      <Avatar className="w-10 h-10">
        <AvatarFallback className="bg-primary/20 text-primary">
          {contact.display_name?.[0]?.toUpperCase() || contact.username?.[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{contact.display_name || contact.username}</p>
        <p className="text-xs text-muted-foreground truncate">@{contact.username}</p>
      </div>
      <Button
        size="sm"
        onClick={onAdd}
        disabled={adding}
      >
        {adding ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <UserPlus className="w-4 h-4 mr-1" />
            Add
          </>
        )}
      </Button>
    </div>
  );
}
