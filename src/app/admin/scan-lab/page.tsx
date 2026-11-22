// Card scanner experiment (David, Nov 21, 2026): a hidden page to measure how well a phone browser can recognize cards
// before we build a real scanner. Admin only (everyone else gets "page not found"), not linked anywhere; results stay
// in the browser. Plan and research: docs/spec.md, "Card scanner research".
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin/access";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getCurrentUser } from "@/lib/supabase/user";
import { ScanLab } from "./scan-lab";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return {
    title: isAdmin(user?.id) ? "Scanner lab · Deck Genome" : "Page not found · Deck Genome",
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function ScanLabPage() {
  await requireAdmin();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <p className="eyebrow">Admin · experiment</p>
      <h1 className="display text-3xl">Scanner lab</h1>
      <p className="mt-2 text-sm opacity-75">
        Tests three ways of recognizing a card from your phone: reading its name, reading the small print in the bottom-left
        corner (set, number, language), and comparing the picture with every printing. After each scan, tap the printing you
        really scanned so the page can score each method. Results stay on this phone until you copy them.
      </p>
      <ScanLab />
    </main>
  );
}
