import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commander Tags",
  description: "A Commander deck builder driven by Scryfall Tagger tags.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
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
