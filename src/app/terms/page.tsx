import Link from "next/link";

export const metadata = {
  title: "Terms · Deck Genome",
  description: "The ground rules for using Deck Genome.",
};

// Plain-language draft (Nov 9, 2026). David reviews the wording; it is not legal advice.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Last updated November 9, 2026</p>
      <h1 className="display text-3xl sm:text-4xl">Terms</h1>
      <div className="mt-6 space-y-4 leading-relaxed">
        <p>Deck Genome is a free Commander deck builder. By using it you agree to these few rules.</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong>Your decks are yours.</strong> You can download or delete them at any time from{" "}
            <Link href="/settings" className="underline">Settings</Link>. When you share a deck, you let others view it, playtest it and
            copy it into their own account.
          </li>
          <li>
            <strong>Be decent.</strong> Don&apos;t put abusive or illegal content in deck names, descriptions or tags, and don&apos;t try to
            break, overload or scrape the site. We may remove content or accounts that do.
          </li>
          <li>
            <strong>No guarantees.</strong> The site is offered as it is. Card data, prices, legality and bracket estimates come from public
            sources and can be wrong or out of date, so check before a tournament or a purchase. Keep your own copy of decks that matter to you.
          </li>
          <li>
            <strong>Fan Content.</strong> Deck Genome is unofficial Fan Content permitted under the{" "}
            <a href="https://company.wizards.com/en/legal/fancontentpolicy" className="underline" target="_blank" rel="noopener noreferrer">
              Fan Content Policy
            </a>
            . Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast
            LLC. Card data and images come from Scryfall, and precon lists from MTGJSON. The site is free to use.
          </li>
          <li>
            <strong>Changes.</strong> We may change these terms or the site. We&apos;ll update the date above when the terms change.
          </li>
        </ol>
        <p>
          See also the <Link href="/privacy" className="underline">privacy page</Link>.
        </p>
      </div>
    </main>
  );
}
