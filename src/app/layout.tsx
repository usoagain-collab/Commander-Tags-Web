import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { getProfileLook } from "@/lib/supabase/profile";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

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
    <html lang="en" data-theme={theme} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="antialiased min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="px-6 py-4 text-xs opacity-70">
          Card data, images and tags courtesy of{" "}
          <a className="underline" href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
            Scryfall
          </a>
          . Not affiliated with Wizards of the Coast.
        </footer>
      </body>
    </html>
  );
}
