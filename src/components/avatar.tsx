/** A round profile picture, or the first letter of the name when there is none. */
export function Avatar({ url, name, size = 32 }: { url: string | null; name: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (url) return <img src={url} alt="" referrerPolicy="no-referrer" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden style={{ ...style, fontSize: size * 0.45 }} className="flex shrink-0 items-center justify-center rounded-full bg-panel-raised font-semibold">
      {(name?.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
