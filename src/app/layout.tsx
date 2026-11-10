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
        <footer className="px-6 py-4 text-xs opacity-70">
          Card data, images and tags courtesy of{" "}
          <a className="underline" href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
            Scryfall
          </a>
          . Unofficial Fan Content permitted under the Fan Content Policy. Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. ·{" "}
          <Link className="underline" href="/privacy">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/terms">
            Terms
          </Link>
        </footer>
      </body>
    </html>
  );
}
