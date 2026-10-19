// Card details for a list of oracle ids, in batches of 100: the ids go in the request's address, and a few
// hundred of them is longer than the server accepts (found in the 3e big-list check). Works with the browser
// or the server Supabase client. Throws on any error, so callers never mistake a failed load for "no cards".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSummary } from "./model";

export async function fetchSummaries(supabase: SupabaseClient, oracleIds: string[]): Promise<CardSummary[]> {
  const ids = [...new Set(oracleIds)];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const results = await Promise.all(batches.map((b) => supabase.from("card_summaries").select("*").in("oracle_id", b)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Couldn't load card details: ${failed.error.message}`);
  return results.flatMap((r) => (r.data ?? []) as CardSummary[]);
}
