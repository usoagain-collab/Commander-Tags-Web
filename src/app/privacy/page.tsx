import Link from "next/link";

export const metadata = {
  title: "Privacy · Deck Genome",
  description: "What Deck Genome stores about you, why, and how to download or delete it.",
};

// Plain-language draft (Nov 9, 2026). David reviews the wording; it is not legal advice.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Last updated November 9, 2026</p>
      <h1 className="display text-3xl sm:text-4xl">Privacy</h1>
      <p className="mt-4 text-lg opacity-90">
        Deck Genome is a Commander deck builder. We keep only what it needs to save your decks, and we never sell your data or show ads.
      </p>
      <div className="mt-8 space-y-6 leading-relaxed">
        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Your account:</strong> your email address, and the name and picture Discord or Google share when you sign in with them.
              If you make an account with email, the password is stored by our sign-in provider in scrambled (hashed) form; we never see it.
            </li>
            <li>
              <strong>What you build:</strong> decks, deck versions and change history, your own tags, role targets, wish list, collection,
              settings, and a profile picture if you upload one.
            </li>
            <li>
              <strong>Feedback</strong> you send with the Feedback button, with the page you sent it from.
            </li>
          </ul>
        </Section>
        <Section title="What we don't do">
          <ul className="list-disc space-y-1 pl-5">
            <li>We don&apos;t post anything for you on Discord or Google, and we can&apos;t see your messages, friends or files there.</li>
            <li>We don&apos;t sell or rent your data, run ads, or use advertising trackers.</li>
            <li>Playtest games stay in your browser tab and are never sent to us.</li>
          </ul>
        </Section>
        <Section title="Who can see your decks">
          <p>
            New decks are private. You choose per deck whether anyone with the link can open it, or whether it is public. A shared deck shows
            your name and picture as its builder.
          </p>
        </Section>
        <Section title="Services we use">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Supabase</strong> stores the database and handles sign-in (servers in the United States).
            </li>
            <li>
              <strong>Vercel</strong> runs the website.
            </li>
            <li>
              <strong>Scryfall</strong> supplies card data and images. Your browser loads card images and some searches straight from Scryfall,
              so Scryfall sees those requests the way any website you visit would.
            </li>
            <li>
              <strong>Discord and Google</strong>, only if you choose to sign in with them.
            </li>
          </ul>
        </Section>
        <Section title="Cookies">
          <p>We use only the cookies needed to keep you signed in. Your browser also remembers a few display choices on this device.</p>
        </Section>
        <Section title="Your data, your call">
          <p>
            In <Link href="/settings" className="underline">Settings</Link> you can download everything you made as a text file, and delete your
            account. Deleting it removes your decks and everything else listed above for good.
          </p>
        </Section>
        <Section title="Questions">
          <p>Use the Feedback button at the top of any page while signed in, and we&apos;ll get back to you.</p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="display mb-2 text-xl">{title}</h2>
      {children}
    </section>
  );
}
