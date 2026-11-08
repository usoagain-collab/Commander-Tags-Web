// One-time setup for v2 Precons: the account that owns every precon deck. It has no password, so nobody can sign
// in as it. Safe to re-run: an existing account is reused. Run: node --env-file=.env.local scripts/create-precon-account.mjs
import { createClient } from "@supabase/supabase-js";

export const PRECON_EMAIL = "precons@commander-tags.test";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({ email: PRECON_EMAIL, email_confirm: true, user_metadata: { full_name: "Deck Genome Precons" } });
if (error && !/already/i.test(error.message)) throw error;
console.log(error ? "Account already exists." : `Created ${data.user.id}`);
