"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ContactsList } from "@/components/contacts";
import { useAuth } from "@/hooks";

export default function ContactsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/signin?redirect=/contacts");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8">
        <ContactsList />
      </div>
    </div>
  );
}
