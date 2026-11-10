import type { MetadataRoute } from "next";
import { headers } from "next/headers";

// The app never hard-codes its own address, so the sitemap link follows whatever host served this request.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "deckgenome.com";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/settings", "/collection", "/wishlist"] },
    sitemap: `https://${host}/sitemap.xml`,
  };
}
