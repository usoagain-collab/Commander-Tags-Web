import type { Metadata } from "next";
import { Cinzel, Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { getProfileLook } from "@/lib/supabase/profile";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const cinzel = Cinzel({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-cinzel", display: "swap" });

export const metadata: Metadata = {
  title: "Deck Genome",
  description: "Build Commander decks by what cards do. Role targets, tag-driven suggestions and a goldfish table.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Set on the server, so a light-mode user never sees a dark flash while the page loads.
  const { theme } = await getProfileLook();
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${fraunces.variable} ${cinzel.variable}`}>
      <body className="antialiased min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="space-y-1.5 px-6 py-4 text-xs leading-relaxed opacity-70">
          <p>
            Deck Genome is unofficial Fan Content permitted under the{" "}
            <a className="underline" href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener noreferrer">
              Fan Content Policy
            </a>
            . Not approved or endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast.
            ©Wizards of the Coast LLC.
          </p>
          <p>
            Magic: The Gathering, its logos, mana symbols, set symbols, card names, card text, card images and card artwork are trademarks
            and copyrights of Wizards of the Coast LLC, a subsidiary of Hasbro, Inc., in the United States and other countries, and of the
            individual artists. All rights reserved. Deck Genome is not produced by, affiliated with, sponsored by or endorsed by Wizards of
            the Coast, Hasbro, Scryfall or MTGJSON.
          </p>
          <p>
            Card data, images and tags courtesy of{" "}
            <a className="underline" href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
              Scryfall
            </a>
            ; preconstructed deck lists from{" "}
            <a className="underline" href="https://mtgjson.com" target="_blank" rel="noopener noreferrer">
              MTGJSON
            </a>
            . Prices, legality and bracket estimates are for information only and come with no guarantee of accuracy. Deck Genome is free and
            provided as is; see the{" "}
            <Link className="underline" href="/terms">
              Terms
            </Link>{" "}
            and{" "}
            <Link className="underline" href="/privacy">
              Privacy
            </Link>{" "}
            pages.
          </p>
        </footer>
      </body>
    </html>
  );
}
