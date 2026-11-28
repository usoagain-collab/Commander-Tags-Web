# Terms and limits, with sources (Gate 0)

Checked Nov 27, 2026. Each row quotes the source and links it. Status: **signed off by David, Nov 27, 2026 (8:26 PM HST).**

## Summary

| Topic | Answer | Effect on the plan |
| --- | --- | --- |
| XMage license | **MIT** | The Phase 2 comparison harness is fine. We still copy no XMage code; reading behavior is allowed anyway. |
| Wizards Fan Content Policy | **No paid tiers.** Ads, donations (Patreon) and sponsors are allowed | **The deck lab and a Claude coach can never be paywalled.** They can be free, paid for by donations, sponsors or ads. |
| Anthropic terms for the card compiler on a Max plan | **Gray area.** Consumer Terms bar access "through automated or non-human means" unless by API key; Claude Code's docs say Max limits assume "ordinary, individual usage" | Run the first 500 cards as normal Claude Code sessions David starts. Don't build an unattended loop on the Max plan. Before scaling past 500, move the runner to an API key or get Anthropic to confirm in writing. |
| Cloudflare Durable Objects | 128 MB memory, 30 s CPU per request (up to 5 min), 10 GB storage per object, $5/month minimum | Fits the plan. The bot worker stays separate so a long think never blocks a table. |

## 1. XMage license

- Source: https://github.com/magefree/mage/blob/master/LICENSE.txt
- Quote: "MIT License ... Permission is hereby granted, free of charge, to any person obtaining a copy of this software ... to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software ..., subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
- For us: the harness runs XMage on David's laptop to compare results. Nothing from XMage ships with the site or the repo build, so even the notice condition doesn't come up. If we ever copied XMage code, we'd have to keep its notice.

## 2. Wizards of the Coast Fan Content Policy

- Source: https://company.wizards.com/en/legal/fancontentpolicy (page says "Last Updated: November 15, 2017")
- Quotes:
  - "One word: F-R-E-E"
  - "You can't require payments, surveys, downloads, subscriptions, or email registration to access your Fan Content;"
  - "You can't sell or license your Fan Content to any third parties for any type of compensation"
  - "You can, however, subsidize your Fan Content by taking advantage of sponsorships, ad revenue, and donations ... so long as it doesn't interfere with the Community's access to your Fan Content."
  - FAQ: donations "on sites like Patreon" and "ad/click revenue on sites like Twitch and YouTube" are OK "so long as it follows this Policy".
  - FAQ: "You can require a login/sign up to play a private group game. That doesn't violate our condition that you let the Community freely access Fan Content."
  - "For any other licensing of Fan Content that earns you compensation, you'll need our advance written permission."
- **Answer: nothing can ever be behind a paywall or subscription** without Wizards' written permission. Sign-in is fine. Ads, donations and sponsors are fine if everyone keeps free access.
- Wrinkle, not a blocker: the policy also says no "email registration to access" content, but its FAQ allows a login for private games. Our sign-in for saving decks and private tables fits the FAQ. Public pages (shared decks, precons, Browse) already work signed out.
- **Effect:** the plan's "paid tier for deck lab compute or the coach" is out. Options if costs grow: a Patreon or "support the site" button, sponsor slots, or limits that apply to everyone (for example, the deck lab runs overnight for everyone instead of instantly for payers). **This is a goal-level choice for David.**

## 3. Anthropic terms for running the card compiler on a Max plan

- Consumer Terms (Effective Oct 8, 2025): https://www.anthropic.com/legal/consumer-terms
  - Section 3, item 7: you may not, "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, ... access the Services through automated or non-human means, whether through a bot, script, or otherwise."
  - "We may suspend or terminate your access to the Services (including any Subscriptions) at any time without notice to you"
  - Outputs: "we assign to you all of our right, title, and interest—if any—in Outputs", so the scripts Claude writes are David's.
- Claude Code legal page: https://code.claude.com/docs/en/legal-and-compliance
  - "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
  - OAuth (plan sign-in) "is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - "Developers building products or services that interact with Claude's capabilities" should use "API key authentication".
  - "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- **Reading:** David using Claude Code (an Anthropic app) himself to write files for his own site is ordinary individual use. What looks risky is a **script that keeps starting sessions with nobody there**, hour after hour: that reads as "automated or non-human means", and the plan's limits assume ordinary use. A ban would also take David's own Claude account with it.
- **Recommendation:**
  1. **Phase 1 (500 cards):** David starts each compiler session himself (one tap: "compile the next 50 cards"); each session works through its batch and opens a PR. That's ordinary use, and it measures the pace.
  2. **Before going past 500**, either switch the runner to an **API key** (Commercial Terms, pay per use; PR 6 reports the cost per card so the bill is known first) or ask Anthropic support to confirm scheduled batch runs on Max in writing.
  3. The runner stays behind one interface, so the switch is a setting.

## 4. Cloudflare Workers and Durable Objects

Sources (all "Last updated" Nov 13 or Nov 25, 2026):
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/

| Limit (Workers Paid plan) | Quote |
| --- | --- |
| Memory | "Memory per isolate: 128 MB"; DO pricing bills "the 128 MB of memory your Durable Object is allocated" |
| CPU per request (DO) | "30 seconds (default) / configurable to 5 minutes of active CPU time"; each HTTP request or WebSocket message resets it |
| CPU per request (plain Worker, the bot worker) | "5 min (default: 30 seconds)" |
| Storage | per object "10 GB"; per account "Unlimited" |
| Row / value size | "Key and value combined cannot exceed 8 MB"; SQL statement "100 KB" |
| WebSocket message | "32 MiB (only for received messages)" |
| Requests per object | soft limit "1,000 requests per second" |
| Alarms | alarm handler wall time "15 minutes"; each `setAlarm()` billed as one row written |
| Requests price | "1 million / month, + $0.15/million" (incoming WebSocket messages count 20:1) |
| Duration price | "400,000 GB-s / month, + $12.50/million GB-s" |
| SQLite storage | rows read "First 25 billion / month included"; rows written "First 50 million / month included + $1.00 / million rows"; stored "5 GB-month, + $0.20/ GB-month" |
| Base price | "minimum $5/mo usage" (from the pricing page's examples) |

**Fit check:** a Commander game state is well under 1 MB; per-action records plus a snapshot each turn is a few hundred rows per game, so 50 million included row writes covers far more games than we'll have. The only real risk is **duration**: a table that stays connected bills 128 MB for as long as it's awake. WebSocket hibernation (sleeping between messages) keeps that low, and the PR 3 cost proof ("100 games measured, inside the $5 plan") checks it.

## Decision (David, Nov 27, 2026): option A

**Everything stays free, with a support button (Patreon or Ko-fi), plus limits that apply to everyone if costs need it.**

**Fan Content Policy means no paid tiers ever.** The plan said a Claude coach and deck lab compute would be paid "only if the policy allows". It doesn't. Options:

- **A (recommended): everything free; costs covered by a "support the site" button (Patreon or Ko-fi) and, if needed, limits that apply to everyone.** Fits the policy as written.
- B: ask Wizards for written permission for a paid tier (the policy allows "advance written permission"). Slow and uncertain.
- C: drop the Claude coach from the backlog.
