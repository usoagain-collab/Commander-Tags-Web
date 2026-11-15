// Turn off the monthly check-in emails from the link at the bottom of each one (V3, migration 0063). Opening the
// page changes nothing (mail scanners open links); the button does. Mail apps' own Unsubscribe uses /api/checkin/stop.
import type { Metadata } from "next";
import { StopForm } from "./stop-form";

export const metadata: Metadata = { title: "Stop check-in emails · Deck Genome", robots: { index: false, follow: false } };

export default async function StopPage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const { u = "", t = "" } = await searchParams;
  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Stop check-in emails</h1>
      <p className="mt-2 opacity-80">You&apos;ll stop getting the monthly three-question email. You can turn it back on in Settings.</p>
      <StopForm u={u} t={t} />
    </main>
  );
}
