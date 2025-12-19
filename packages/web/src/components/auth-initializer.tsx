"use client";

import { useAuth } from "@/hooks/use-auth";

export function AuthInitializer() {
  useAuth();
  return null;
}
