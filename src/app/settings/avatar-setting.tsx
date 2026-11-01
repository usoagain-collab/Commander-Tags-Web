"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { CardSummary } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "avatars";
const SIZE = 256;

/** Cut the middle square out of a photo and shrink it, so uploads stay small and any photo size works. */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("no image");
  return blob;
}

/** Profile picture: card art from our data, or an uploaded photo. Stored as one address in profiles.avatar_url. */
export function AvatarSetting({ userId, name, initial }: { userId: string; name: string | null; initial: string | null }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_cards", { q, lim: 12 });
      if (current) setResults(((data ?? []) as CardSummary[]).filter((c) => c.image_art_crop));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, supabase]);

  /** Save the new address, then clear out older uploads (keep = the file that is now in use). */
  async function save(next: string | null, keep?: string) {
    const { error } = await supabase.from("profiles").update({ avatar_url: next }).eq("id", userId);
    if (error) {
      setMessage(`Couldn't save that: ${error.message}`);
      return false;
    }
    setUrl(next);
    setMessage("Saved.");
    const { data: files } = await supabase.storage.from(BUCKET).list(userId);
    const old = (files ?? []).filter((f) => f.name !== keep).map((f) => `${userId}/${f.name}`);
    if (old.length) await supabase.storage.from(BUCKET).remove(old);
    router.refresh();
    return true;
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    await work();
    setBusy(false);
  }

  async function upload(file: File) {
    let image: Blob;
    try {
      image = await squareImage(file);
    } catch {
      setMessage("Couldn't read that file. Try a JPG or PNG photo.");
      return;
    }
    // Browsers without WebP export hand back a PNG instead, so the name follows the real type.
    const fileName = `${crypto.randomUUID()}.${image.type === "image/webp" ? "webp" : "png"}`;
    const path = `${userId}/${fileName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, image, { contentType: image.type });
    if (error) {
      setMessage(`Couldn't upload that: ${error.message}`);
      return;
    }
    const saved = await save(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, fileName);
    if (!saved) await supabase.storage.from(BUCKET).remove([path]);
  }

  return (
    <section className="mt-6">
      <h2 className="display text-xl">Profile picture</h2>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Avatar url={url} name={name} size={88} />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn min-h-11">
            {busy ? "Saving…" : "Upload a photo"}
          </button>
          {url && (
            <button type="button" disabled={busy} onClick={() => run(() => save(null))} className="btn min-h-11">
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Upload a photo"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run(() => upload(file));
          }}
        />
      </div>
      <label className="mt-4 block text-sm font-medium" htmlFor="avatar-card">
        Or use a card&apos;s art
      </label>
      <input
        id="avatar-card"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search for a card…"
        autoComplete="off"
        className="mt-1 min-h-11 w-full rounded-lg border border-foreground/20 bg-transparent px-3"
      />
      {results.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {results.map((c) => (
            <button
              key={c.oracle_id}
              type="button"
              disabled={busy}
              onClick={() => run(() => save(c.image_art_crop))}
              aria-pressed={url === c.image_art_crop}
              className={`panel card-lift overflow-hidden text-left ${url === c.image_art_crop ? "border-gold" : ""}`}
            >
              <img src={c.image_art_crop!} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <span className="block truncate px-2 py-1.5 text-xs">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>
    </section>
  );
}
