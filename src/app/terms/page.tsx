import Link from "next/link";

export const metadata = {
  title: "Terms · Deck Genome",
  description: "The ground rules for using Deck Genome.",
};

const ext = { target: "_blank", rel: "noopener noreferrer", className: "underline" } as const;

// Plain-language draft (Nov 11, 2026). David reviews the wording; it is not legal advice.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Last updated November 11, 2026</p>
      <h1 className="display text-3xl sm:text-4xl">Terms</h1>
      <div className="mt-6 space-y-4 leading-relaxed">
        <p>
          Deck Genome is a free Commander deck builder. By using it you agree to these terms. If you don&apos;t agree, please don&apos;t use
          the site.
        </p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong>Your decks are yours.</strong> You can download or delete them at any time from{" "}
            <Link href="/settings" className="underline">Settings</Link>. So that the site can work, you let Deck Genome store, display and
            back up what you save. When you share a deck, you let others view it, playtest it and copy it into their own account. You are
            responsible for what you post, and you confirm you have the right to post it.
          </li>
          <li>
            <strong>Be decent.</strong> Don&apos;t put abusive or illegal content in deck names, descriptions or tags, and don&apos;t try to
            break, overload or scrape the site. We may remove content or accounts that do, at any time and without notice.
          </li>
          <li>
            <strong>Fan Content.</strong> Deck Genome is unofficial Fan Content permitted under the{" "}
            <a href="https://company.wizards.com/en/legal/fancontentpolicy" {...ext}>Fan Content Policy</a>. Not approved or endorsed by
            Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. The site is
            free to use, and nothing on it is sold or placed behind a paywall.
          </li>
          <li>
            <strong>Trademarks and card art.</strong> Magic: The Gathering, its logos, mana symbols, set symbols, card names, card text, card
            images and card artwork are trademarks and copyrights of Wizards of the Coast LLC, a subsidiary of Hasbro, Inc., in the United
            States and other countries, and of the individual artists. All rights reserved. Deck Genome claims no ownership of them. Wherever
            card art is shown without the full card, the artist is credited on the same screen.
          </li>
          <li>
            <strong>No affiliation.</strong> Deck Genome is an independent project. It is not produced by, affiliated with, sponsored by or
            endorsed by Wizards of the Coast, Hasbro, Scryfall or MTGJSON.
          </li>
          <li>
            <strong>Where the data comes from.</strong> Card data, images and tags come from{" "}
            <a href="https://scryfall.com" {...ext}>Scryfall</a>, and preconstructed deck lists from{" "}
            <a href="https://mtgjson.com" {...ext}>MTGJSON</a>. Those services have their own terms, and Deck Genome is not responsible for
            their content, availability or accuracy, or for other sites it links to.
          </li>
          <li>
            <strong>No guarantees.</strong> The site is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any
            kind, express or implied, including any warranty of accuracy, merchantability, fitness for a particular purpose or
            non-infringement. Card data, prices, legality and bracket estimates come from public sources and can be wrong or out of date.
            Prices are daily estimates for information only and are not an offer to buy or sell. Check before a tournament or a purchase,
            and keep your own copy of decks that matter to you. The site may change, go down or lose data at any time.
          </li>
          <li>
            <strong>Limits on liability.</strong> To the fullest extent the law allows, Deck Genome and the people who run it are not liable
            for any indirect, incidental, special or consequential loss, or for lost data, money or time, arising from your use of the site,
            even if told such loss was possible. Because the site is free, our total liability for any claim is limited to US$50. Some places
            don&apos;t allow these limits, so they apply only as far as your local law permits.
          </li>
          <li>
            <strong>Copyright concerns.</strong> If you believe something on Deck Genome infringes your rights, email{" "}
            <a href="mailto:usoagain@gmail.com" className="underline">usoagain@gmail.com</a> with what it is and where it appears, and we
            will look into it and remove it where appropriate.
          </li>
          <li>
            <strong>Changes.</strong> We may change these terms or the site. We&apos;ll update the date above when the terms change, and
            using the site after a change means you accept the new terms.
          </li>
        </ol>
        <p>
          See also the <Link href="/privacy" className="underline">privacy page</Link>.
        </p>
      </div>
    </main>
  );
}
