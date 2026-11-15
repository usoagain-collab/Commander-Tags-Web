import Link from "next/link";
import { GUIDE_STEPS, startingTargets } from "@/lib/guide/guide";

export const metadata = {
  title: "Build your first deck · Deck Genome",
  description: "A step-by-step guide to building a Commander deck in Deck Genome, from picking a commander to adjusting role targets, cutting to 100 and playtesting.",
};

// V3 "Build your first deck" guide: every tool in the order a new builder meets it. Content lives in
// src/lib/guide/guide.ts so the starting targets come from the code.
export default function GuidePage() {
  const targets = startingTargets();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Guide</p>
      <h1 className="display text-3xl sm:text-4xl">Build your first deck</h1>
      <p className="mt-4 text-lg opacity-90">
        A Commander deck is 100 cards led by one legendary creature. Deck Genome sorts your cards into the jobs a deck has to do, so you can
        see what&apos;s missing at a glance. Here is every tool, in the order you&apos;ll need it.
      </p>

      <nav aria-label="Steps" className="panel mt-6 p-4">
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {GUIDE_STEPS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline-offset-2 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-8 leading-relaxed">
        {GUIDE_STEPS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="display mb-2 text-xl">{s.title}</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              {s.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {s.id === "roles" && (
              <div className="mt-3 overflow-hidden rounded-lg border border-foreground/15">
                <table className="w-full text-sm">
                  <caption className="px-3 pt-2 text-left text-xs opacity-70">What a new deck aims for</caption>
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-1.5 font-medium">Role</th>
                      <th className="px-3 py-1.5 text-right font-medium">Starting target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr key={t.name} className="border-t border-foreground/10">
                        <td className="px-3 py-1.5">{t.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{t.target ?? "Follows your bracket"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="panel mt-10 p-5 text-center">
        <p className="display text-xl">Ready to build?</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Link href="/decks" className="btn btn-gold min-h-11">
            Go to My decks
          </Link>
          <Link href="/try" className="btn min-h-11">
            Try it without an account
          </Link>
          <Link href="/precons" className="btn min-h-11">
            Start from a precon
          </Link>
        </div>
      </div>
    </main>
  );
}
