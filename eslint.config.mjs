import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Card images and mana symbols load straight from Scryfall's CDN (CLAUDE.md). Next's <Image> would
      // re-host them through Vercel's image optimizer and use up the free-tier quota for no gain.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // The rules engine (docs/engine-design.md): states are never changed in place, and the engine has no
    // React, Next, database or network code, so it runs the same in the browser, Node and Cloudflare.
    files: ["src/lib/engine/**/*.ts"],
    rules: {
      "no-param-reassign": ["error", { props: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-*", "next", "next/*", "@supabase/*", "server-only"], message: "The engine stays free of UI, server and database code." },
            { group: ["@/*", "!@/lib/engine", "!@/lib/engine/*"], message: "The engine imports only its own modules." },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
