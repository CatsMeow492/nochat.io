import { InviteClient } from "./invite-client";

// Required for static export with optional catch-all route
// Returns empty array for the base /invite route
export function generateStaticParams() {
  return [{ code: [] }];
}

export default function InvitePage() {
  return <InviteClient />;
}
