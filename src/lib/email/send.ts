// Sends one email (V3 monthly check-in). Server-only. Nothing is sent until an email service is chosen and its key is
// set on Vercel: with EMAIL_API_KEY or EMAIL_FROM missing, emailReady() is false and sendEmail() refuses.
// Written for Resend's HTTP API (one fetch, no library). Another service only needs this one file changed.
import "server-only";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

export function emailReady(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(mail: OutgoingEmail): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  // Optional: where replies go (the From address has no inbox).
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;
  if (!key || !from) return { ok: false, error: "No email service is set up yet." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, headers: mail.headers, reply_to: replyTo }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, error: body?.message ?? `The email service answered ${res.status}.` };
  } catch {
    return { ok: false, error: "Couldn't reach the email service." };
  }
}
