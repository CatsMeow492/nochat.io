"use client";

import { useState } from "react";
import {
  UserPlus,
  UserMinus,
  Check,
  X,
  MoreHorizontal,
  Link2,
  QrCode,
  Search,
  Users,
  Clock,
  Ban,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useContacts, usePendingRequests, type Contact } from "@/hooks/use-contacts";
import { useContactSync, usePhoneVerification } from "@/hooks/use-contact-sync";
import { cn } from "@/lib/utils";
import { AddContactDialog } from "./add-contact-dialog";
import { DiscoveredContacts } from "./discovered-contacts";
import { PhoneVerification } from "@/components/settings/phone-verification";

export function ContactsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const {
    contacts,
    loading: contactsLoading,
    acceptRequest,
    blockContact,
    deleteContact,
  } = useContacts("accepted");

  const {
    requests,
    count: pendingCount,
    loading: requestsLoading,
    acceptRequest: acceptPending,
    blockRequest: blockPending,
  } = usePendingRequests();

  const {
    contacts: blockedContacts,
    loading: blockedLoading,
    deleteContact: unblockContact,
  } = useContacts("blocked");

  const { discovered } = useContactSync();

  const isLoading = contactsLoading || requestsLoading || blockedLoading;

  const filteredContacts = contacts.filter((c) => {
    if (!searchQuery) return true;
    const name = c.contact_user.display_name || c.contact_user.username;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleDeleteContact = async () => {
    if (selectedContact) {
      await deleteContact(selectedContact.id);
      setDeleteConfirmOpen(false);
      setSelectedContact(null);
    }
  };

  const handleUnblock = async (contact: Contact) => {
    await unblockContact(contact.id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Contacts</h1>
          <Button
            size="sm"
            onClick={() => setAddContactOpen(true)}
            className="gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Add Contact
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary/50 border-border"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <div className="border-b border-border px-4">
          <TabsList className="h-12 p-0 bg-transparent gap-4">
            <TabsTrigger
              value="all"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
            >
              <Users className="w-4 h-4 mr-2" />
              All
              <Badge variant="secondary" className="ml-2 h-5">
                {contacts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
            >
              <Clock className="w-4 h-4 mr-2" />
              Pending
              {pendingCount > 0 && (
                <Badge variant="default" className="ml-2 h-5">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="blocked"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
            >
              <Ban className="w-4 h-4 mr-2" />
              Blocked
            </TabsTrigger>
            <TabsTrigger
              value="discover"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
            >
              <Smartphone className="w-4 h-4 mr-2" />
              Discover
              {discovered.length > 0 && (
                <Badge variant="default" className="ml-2 h-5">
                  {discovered.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <TabsContent value="all" className="m-0 p-4">
            {isLoading ? (
              <LoadingState />
            ) : filteredContacts.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No contacts yet"
                description="Add contacts to start chatting securely"
              />
            ) : (
              <div className="space-y-2">
                {filteredContacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    onBlock={() => blockContact(contact.id)}
                    onDelete={() => {
                      setSelectedContact(contact);
                      setDeleteConfirmOpen(true);
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pending" className="m-0 p-4">
            {requestsLoading ? (
              <LoadingState />
            ) : requests.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No pending requests"
                description="When someone sends you a contact request, it will appear here"
              />
            ) : (
              <div className="space-y-2">
                {requests.map((request) => (
                  <PendingRequestCard
                    key={request.id}
                    request={request}
                    onAccept={() => acceptPending(request.id)}
                    onBlock={() => blockPending(request.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="blocked" className="m-0 p-4">
            {blockedLoading ? (
              <LoadingState />
            ) : blockedContacts.length === 0 ? (
              <EmptyState
                icon={Ban}
                title="No blocked contacts"
                description="Blocked contacts will appear here"
              />
            ) : (
              <div className="space-y-2">
                {blockedContacts.map((contact) => (
                  <BlockedContactCard
                    key={contact.id}
                    contact={contact}
                    onUnblock={() => handleUnblock(contact)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="discover" className="m-0 p-4 space-y-4">
            <PhoneVerification />
            <DiscoveredContacts />
          </TabsContent>
        </ScrollArea>
      </Tabs>

      {/* Add Contact Dialog */}
      <AddContactDialog
        open={addContactOpen}
        onOpenChange={setAddContactOpen}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium">
                {selectedContact?.contact_user.display_name}
              </span>{" "}
              from your contacts? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteContact}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContactCard({
  contact,
  onBlock,
  onDelete,
}: {
  contact: Contact;
  onBlock: () => void;
  onDelete: () => void;
}) {
  const user = contact.contact_user;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors group">
      <Avatar className="w-10 h-10">
        <AvatarFallback className="bg-primary/20 text-primary">
          {user.display_name?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{user.display_name || user.username}</p>
        <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onBlock}>
            <Ban className="w-4 h-4 mr-2" />
            Block
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <UserMinus className="w-4 h-4 mr-2" />
            Remove Contact
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PendingRequestCard({
  request,
  onAccept,
  onBlock,
}: {
  request: Contact;
  onAccept: () => void;
  onBlock: () => void;
}) {
  const user = request.contact_user;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
      <Avatar className="w-10 h-10">
        <AvatarFallback className="bg-primary/20 text-primary">
          {user.display_name?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{user.display_name || user.username}</p>
        <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBlock}
          className="text-destructive hover:text-destructive"
        >
          <X className="w-4 h-4" />
        </Button>
        <Button size="sm" onClick={onAccept}>
          <Check className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function BlockedContactCard({
  contact,
  onUnblock,
}: {
  contact: Contact;
  onUnblock: () => void;
}) {
  const user = contact.contact_user;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
      <Avatar className="w-10 h-10 opacity-50">
        <AvatarFallback className="bg-muted text-muted-foreground">
          {user.display_name?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-muted-foreground">
          {user.display_name || user.username}
        </p>
        <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onUnblock}>
        Unblock
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
    </div>
  );
}
