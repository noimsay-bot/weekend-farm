"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

export function SignOut() {
  async function signOut() {
    await createClient().auth.signOut();
    window.location.replace("/login");
  }
  return (
    <Button variant="secondary" className="mt-auto" onClick={signOut}>
      로그아웃
    </Button>
  );
}
