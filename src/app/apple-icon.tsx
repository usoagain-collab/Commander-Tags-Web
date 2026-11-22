import { ImageResponse } from "next/og";

// Home-screen icon for iPhones and iPads (they don't use SVG icons): the same genome mark as icon.svg, drawn at 180 px.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const COLORS = ["#c9a26b", "#5fbf7f", "#5aa9e6", "#ef6a4f", "#b08be0"];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#0b0c10" }}>
        {COLORS.map((c) => (
          <div key={c} style={{ width: 17, height: 112, borderRadius: 6, background: c }} />
        ))}
      </div>
    ),
    size,
  );
}
