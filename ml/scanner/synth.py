"""Fake training photos for the corner finder, made on the graphics card.

Each sample: one of David's surface frames (or a made-up texture) as the
table, sometimes other cards around or under the card, the card itself at any
rotation and tilted in 3D, a sleeve edge, a finger, glare, foil sheen, shadow,
blur, noise and JPEG blockiness. 20% have no card.

Targets per sample:
- present: is there a card to find;
- corners: (4, 2) in pixels of the output image, in the card's own order
  (top-left as the card reads, then clockwise), so the model also learns which
  way up the card is;
- hidden: (4,) whether something covers that corner.

Everything is batched torch on the GPU (the laptop's 4 processor cores can't
make photos fast enough).
"""

import math
from dataclasses import dataclass

import torch
import torch.nn.functional as F
from kornia.enhance import jpeg_codec_differentiable
from kornia.filters import gaussian_blur2d, motion_blur
from kornia.geometry.transform import get_perspective_transform, warp_perspective

OUT_H, OUT_W = 384, 256          # portrait, like a phone camera frame
CARD_ASPECT = 88 / 63            # height / width of a Magic card
CORNER_RADIUS = 2.5 / 63         # corner radius as a share of card width


@dataclass
class Batch:
    image: torch.Tensor     # (B, 3, H, W) float 0..1
    present: torch.Tensor   # (B,) float 0/1
    corners: torch.Tensor   # (B, 4, 2) pixels (x, y)
    hidden: torch.Tensor    # (B, 4) float 0/1


def rounded_mask(h: int, w: int, device) -> torch.Tensor:
    """(1, 1, h, w) alpha with the card's rounded corners cut out."""
    r = CORNER_RADIUS * w
    ys = torch.arange(h, device=device).float() + 0.5
    xs = torch.arange(w, device=device).float() + 0.5
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")
    cx = torch.clamp(xx, r, w - r)
    cy = torch.clamp(yy, r, h - r)
    d = torch.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    return torch.clamp(r - d + 0.5, 0, 1)[None, None]


class Synth:
    def __init__(self, cards: torch.Tensor, backgrounds: torch.Tensor, device="cuda", seed: int | None = None):
        """cards: (N, H, W, 3) uint8 (CPU, pinned is best); backgrounds: (M, H, W, 3) uint8."""
        self.cards = cards
        self.bgs = backgrounds.to(device).permute(0, 3, 1, 2).contiguous()  # uint8 on GPU
        self.device = device
        self.ch, self.cw = cards.shape[1], cards.shape[2]
        self.mask = rounded_mask(self.ch, self.cw, device)
        self.gen = torch.Generator(device=device)
        self.cpu_gen = torch.Generator()
        if seed is not None:
            self.gen.manual_seed(seed)
            self.cpu_gen.manual_seed(seed)
        else:
            self.gen.seed()
            self.cpu_gen.seed()
        ys = torch.arange(OUT_H, device=device).float() + 0.5
        xs = torch.arange(OUT_W, device=device).float() + 0.5
        self.yy, self.xx = torch.meshgrid(ys, xs, indexing="ij")

    # ---------- random helpers ----------
    def u(self, *shape, lo=0.0, hi=1.0):
        return lo + (hi - lo) * torch.rand(*shape, generator=self.gen, device=self.device)

    def chance(self, b, p):
        return self.u(b) < p

    def card_images(self, n: int) -> torch.Tensor:
        idx = torch.randint(0, self.cards.shape[0], (n,), generator=self.cpu_gen)
        imgs = self.cards.index_select(0, idx).to(self.device, non_blocking=True)
        return imgs.permute(0, 3, 1, 2).float() / 255

    # ---------- table ----------
    def backgrounds(self, b: int) -> torch.Tensor:
        idx = torch.randint(0, self.bgs.shape[0], (b,), generator=self.gen, device=self.device)
        src = self.bgs[idx].float() / 255  # (b, 3, bh, bw)
        bh, bw = src.shape[2], src.shape[3]
        # random zoom/crop/flip via an affine grid
        scale = self.u(b, lo=0.45, hi=1.0)
        aspect = (OUT_H / OUT_W) / (bh / bw)
        sx = scale / max(aspect, 1) if aspect > 1 else scale
        sy = scale * min(aspect, 1) if aspect > 1 else scale / aspect
        sy = torch.clamp(sy, max=1.0)
        tx = (1 - sx) * self.u(b, lo=-1, hi=1)
        ty = (1 - sy) * self.u(b, lo=-1, hi=1)
        flip = torch.where(self.chance(b, 0.5), -1.0, 1.0)
        theta = torch.zeros(b, 2, 3, device=self.device)
        theta[:, 0, 0] = sx * flip
        theta[:, 1, 1] = sy
        theta[:, 0, 2] = tx
        theta[:, 1, 2] = ty
        grid = F.affine_grid(theta, (b, 3, OUT_H, OUT_W), align_corners=False)
        bg = F.grid_sample(src, grid, mode="bilinear", padding_mode="reflection", align_corners=False)
        # 15%: made-up texture instead (wood-like stripes, checks, noise, flat)
        tex = self.chance(b, 0.15)
        if tex.any():
            bg[tex] = self.texture(int(tex.sum()))
        # colour jitter per image
        gain = self.u(b, 3, 1, 1, lo=0.75, hi=1.25)
        bg = bg * gain * self.u(b, 1, 1, 1, lo=0.6, hi=1.3)
        return bg.clamp(0, 1)

    def texture(self, n: int) -> torch.Tensor:
        f = self.u(n, 1, 1, lo=0.02, hi=0.25)
        a = self.u(n, 1, 1, lo=0, hi=math.pi)
        c1 = self.u(n, 3, 1, 1)
        c2 = self.u(n, 3, 1, 1)
        t = torch.sin((self.xx * torch.cos(a) + self.yy * torch.sin(a)) * f + self.u(n, 1, 1) * 6.28)
        t = (t[:, None] * 0.5 + 0.5)
        noise = F.interpolate(self.u(n, 1, OUT_H // 8, OUT_W // 8), size=(OUT_H, OUT_W), mode="bilinear")
        kind = self.u(n, 1, 1, 1)
        mix = torch.where(kind < 0.5, t, noise)
        mix = torch.where(kind > 0.85, torch.full_like(mix, 0.5), mix)
        return c1 * mix + c2 * (1 - mix)

    # ---------- card geometry ----------
    def card_quads(self, b: int, min_h: float, max_h: float, max_tilt_deg: float) -> torch.Tensor:
        """(b, 4, 2) projected card corners (TL, TR, BR, BL of the card), centred at 0, unscaled."""
        w, h = 1.0, CARD_ASPECT
        pts = torch.tensor([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
                           device=self.device).expand(b, 4, 2)
        spin = self.u(b, lo=0, hi=2 * math.pi)
        # Most real scans are near upright; keep half within +-25 degrees.
        upright = self.chance(b, 0.5)
        spin = torch.where(upright, self.u(b, lo=-0.44, hi=0.44), spin)
        c, s = torch.cos(spin), torch.sin(spin)
        x = pts[..., 0] * c[:, None] - pts[..., 1] * s[:, None]
        y = pts[..., 0] * s[:, None] + pts[..., 1] * c[:, None]
        # tilt the card plane about a random in-plane axis
        tilt = torch.deg2rad(max_tilt_deg * self.u(b) ** 1.3)
        axis = self.u(b, lo=0, hi=2 * math.pi)
        ax, ay = torch.cos(axis)[:, None], torch.sin(axis)[:, None]
        along = x * ax + y * ay
        across = -x * ay + y * ax
        z = across * torch.sin(tilt)[:, None]
        across = across * torch.cos(tilt)[:, None]
        x = along * ax - across * ay
        y = along * ay + across * ax
        dist = self.u(b, lo=1.6, hi=5.0)[:, None] * h
        x = x * dist / (dist + z)
        y = y * dist / (dist + z)
        quad = torch.stack([x, y], -1)
        return quad - quad.mean(1, keepdim=True)

    def place(self, quad: torch.Tensor, frac_h: torch.Tensor, margin: float, inside: bool) -> torch.Tensor:
        """Scale the quad so its height is frac_h of the image, then move it to a random spot."""
        span = quad.amax(1) - quad.amin(1)  # (b, 2)
        scale = frac_h * OUT_H / span[:, 1]
        # keep it within the frame if asked (shrink when too wide)
        if inside:
            fit = torch.minimum((1 - 2 * margin) * OUT_W / (span[:, 0] * scale),
                                (1 - 2 * margin) * OUT_H / (span[:, 1] * scale))
            scale = scale * torch.clamp(fit, max=1.0)
        q = quad * scale[:, None, None]
        lo, hi = q.amin(1), q.amax(1)
        size = torch.tensor([OUT_W, OUT_H], device=self.device).float()
        if inside:
            low = margin * size - lo
            high = (1 - margin) * size - hi
        else:
            low = -hi + 0.15 * (hi - lo)
            high = size - lo - 0.15 * (hi - lo)
        t = low + (high - low) * self.u(q.shape[0], 2)
        return q + t[:, None, :]

    def place_edge(self, quad: torch.Tensor, frac_h: torch.Tensor) -> torch.Tensor:
        """Scale like place(), then centre the quad on a random point of the frame's border so it
        hangs off the edge: never a second whole card in view."""
        b = quad.shape[0]
        span = quad.amax(1) - quad.amin(1)
        q = quad * (frac_h * OUT_H / span[:, 1])[:, None, None]
        half = (q.amax(1) - q.amin(1)) / 2
        side = torch.randint(0, 4, (b,), generator=self.gen, device=self.device)  # top, bottom, left, right
        along = self.u(b)
        inward = self.u(b, lo=-0.5, hi=0.45)  # centre's distance inside the frame, in half-sizes
        dx, dy = inward * half[:, 0], inward * half[:, 1]
        x = torch.stack([along * OUT_W, along * OUT_W, dx, OUT_W - dx], 1).gather(1, side[:, None])[:, 0]
        y = torch.stack([dy, OUT_H - dy, along * OUT_H, along * OUT_H], 1).gather(1, side[:, None])[:, 0]
        centre = q.mean(1)
        q = q - centre[:, None, :]
        return q + torch.stack([x, y], 1)[:, None, :]

    def warp_cards(self, imgs: torch.Tensor, quads: torch.Tensor):
        """Warp card pictures onto the output frame. Returns (rgb, alpha)."""
        b = imgs.shape[0]
        src = torch.tensor([[0, 0], [self.cw, 0], [self.cw, self.ch], [0, self.ch]],
                           device=self.device).float().expand(b, 4, 2)
        M = get_perspective_transform(src, quads)
        rgba = torch.cat([imgs, self.mask.expand(b, 1, self.ch, self.cw)], 1)
        out = warp_perspective(rgba, M, dsize=(OUT_H, OUT_W), mode="bilinear",
                               padding_mode="zeros", align_corners=False)
        return out[:, :3], out[:, 3:4]

    def quad_alpha(self, quads: torch.Tensor) -> torch.Tensor:
        """Soft filled-quad alpha (for sleeves), via edge half-planes."""
        a = torch.ones(quads.shape[0], OUT_H, OUT_W, device=self.device)
        for i in range(4):
            p, q = quads[:, i], quads[:, (i + 1) % 4]
            ex, ey = (q - p)[:, 0, None, None], (q - p)[:, 1, None, None]
            n = torch.sqrt(ex ** 2 + ey ** 2) + 1e-6
            # signed distance to the edge line (positive inside for clockwise screen order)
            d = ((self.xx - p[:, 0, None, None]) * ey - (self.yy - p[:, 1, None, None]) * ex) / n
            a = a * torch.clamp(0.5 - d, 0, 1)
        return a[:, None]

    # ---------- the whole photo ----------
    @torch.no_grad()
    def batch(self, b: int) -> Batch:
        dev = self.device
        img = self.backgrounds(b)
        present = self.chance(b, 0.8)

        # main card pose
        frac = self.u(b, lo=0.18, hi=0.92)
        quad = self.place(self.card_quads(b, 0.18, 0.92, 52), frac, margin=0.02, inside=True)

        # a deck held in the hand under the card (35%): palm, then layered card edges stepping off
        # in one direction. corners-v1 stretched its outline over these edges on David's photos.
        held = self.chance(b, 0.35) & present
        if held.any():
            img[held] = self.held_deck(quad[held], img[held])

        # cards under the main one: a messy stack with nearly the same pose (25%), or loose ones
        top = torch.zeros(b, 1, OUT_H, OUT_W, device=dev)   # alpha of things drawn over the main card
        n_under = 2
        for k in range(n_under):
            use = self.chance(b, 0.45 if k == 0 else 0.25)
            stack = self.chance(b, 0.5) & present
            loose = self.place_edge(self.card_quads(b, 0.2, 0.9, 45), self.u(b, lo=0.2, hi=0.9))
            jitter = (self.u(b, 4, 2, lo=-1, hi=1) * 0.04 * OUT_H + self.u(b, 1, 2, lo=-1, hi=1) * 0.05 * OUT_H)
            q = torch.where(stack[:, None, None], quad + jitter, loose)
            if use.any():
                rgb, a = self.warp_cards(self.card_images(int(use.sum())), q[use])
                img[use] = img[use] * (1 - a) + rgb * a

        # sleeve (30% of cards): a slightly larger quad, clear, black or coloured
        sleeve = self.chance(b, 0.3) & present
        if sleeve.any():
            grow = self.u(b, lo=1.025, hi=1.06)[:, None, None]
            center = quad.mean(1, keepdim=True)
            sq = center + (quad - center) * grow
            sa = self.quad_alpha(sq) * sleeve[:, None, None, None]
            color = torch.where(self.chance(b, 0.5)[:, None, None, None],
                                self.u(b, 3, 1, 1, lo=0, hi=0.15), self.u(b, 3, 1, 1))
            opacity = torch.where(self.chance(b, 0.4), self.u(b, lo=0.1, hi=0.35), self.u(b, lo=0.7, hi=1.0))
            sa = sa * opacity[:, None, None, None]
            img = img * (1 - sa) + color * sa

        # the card
        rgb, a = self.warp_cards(self.card_images(b), quad)
        # foil rainbow (20%)
        foil = self.chance(b, 0.2)
        if foil.any():
            ang = self.u(b, 1, 1, lo=0, hi=math.pi)
            ph = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) * self.u(b, 1, 1, lo=0.01, hi=0.04)
            rainbow = torch.stack([torch.sin(ph), torch.sin(ph + 2.1), torch.sin(ph + 4.2)], 1) * 0.5 + 0.5
            k = (self.u(b, lo=0.1, hi=0.35) * foil)[:, None, None, None]
            rgb = rgb * (1 - k) + rainbow * k
        a = a * present[:, None, None, None]
        img = img * (1 - a) + rgb * a
        card_alpha = a

        # sleeve sheen over the card (on sleeved cards, and some unsleeved)
        sheen = self.chance(b, 0.35)
        if sheen.any():
            ang = self.u(b, 1, 1, lo=0, hi=2 * math.pi)
            g = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) / OUT_H
            band = torch.exp(-((g - self.u(b, 1, 1, lo=-0.5, hi=1.2)) / self.u(b, 1, 1, lo=0.05, hi=0.3)) ** 2)
            img = img + (band[:, None] * card_alpha * (self.u(b, lo=0.1, hi=0.45) * sheen)[:, None, None, None])

        # a card lying over part of the main card (10%)
        over = self.chance(b, 0.1) & present
        if over.any():
            q = self.place_edge(self.card_quads(b, 0.2, 0.9, 40), frac * self.u(b, lo=0.8, hi=1.1))
            rgb2, a2 = self.warp_cards(self.card_images(int(over.sum())), q[over])
            img[over] = img[over] * (1 - a2) + rgb2 * a2
            top[over] = torch.maximum(top[over], a2)

        # finger over a corner or an edge (30%)
        finger = self.chance(b, 0.3) | (held & self.chance(b, 0.6))
        if finger.any():
            fa, fc = self.finger(b, quad, present)
            fa = fa * finger[:, None, None, None]
            img = img * (1 - fa) + fc * fa
            top = torch.maximum(top, fa)

        img = self.lighting(img, card_alpha)
        img = self.camera(img)

        # which corners are covered
        cx = quad[..., 0].round().long().clamp(0, OUT_W - 1)
        cy = quad[..., 1].round().long().clamp(0, OUT_H - 1)
        bi = torch.arange(b, device=dev)[:, None].expand(b, 4)
        hidden = (top[bi, 0, cy, cx] > 0.5).float() * present[:, None].float()
        return Batch(image=img, present=present.float(), corners=quad, hidden=hidden)

    def held_deck(self, quad: torch.Tensor, img: torch.Tensor) -> torch.Tensor:
        """Draw a palm and a deck's stacked edges under the card quads (h of them)."""
        h = quad.shape[0]
        card_w = (quad[:, 1] - quad[:, 0]).norm(dim=1)
        centre = quad.mean(1)
        # palm: a soft skin disc off to one side, partly under the card
        ang = self.u(h, lo=0, hi=2 * math.pi)
        out = torch.stack([torch.cos(ang), torch.sin(ang)], 1)
        pc = centre + out * (card_w * self.u(h, lo=0.5, hi=0.95))[:, None]
        pr = card_w * self.u(h, lo=0.45, hi=0.75)
        d = torch.sqrt((self.xx - pc[:, 0, None, None]) ** 2 + (self.yy - pc[:, 1, None, None]) ** 2)
        pa = torch.clamp((pr[:, None, None] - d) / 3 + 0.5, 0, 1)[:, None] * self.chance(h, 0.75)[:, None, None, None]
        skin = torch.stack([self.u(h, lo=0.45, hi=0.95), self.u(h, lo=0.3, hi=0.75), self.u(h, lo=0.2, hi=0.65)], 1)
        skin = torch.minimum(skin, skin[:, :1])[:, :, None, None]
        shade = (1 - 0.4 * (d / pr[:, None, None]).clamp(0, 1) ** 2)[:, None]
        img = img * (1 - pa) + skin * shade * pa
        # deck edges: up to 16 layers, each a card outline shifted a little further
        layers = torch.randint(3, 17, (h,), generator=self.gen, device=self.device)
        da = self.u(h, lo=0, hi=2 * math.pi)
        step = (self.u(h, lo=0.002, hi=0.008) * OUT_H)[:, None]
        shift = torch.stack([torch.cos(da), torch.sin(da)], 1) * step
        base = torch.where(self.chance(h, 0.8), self.u(h, lo=0.02, hi=0.2), self.u(h, lo=0.6, hi=0.9))
        tint = self.u(h, 3, lo=0.85, hi=1.15)
        for k in range(16, 0, -1):
            use = layers >= k
            if not use.any():
                continue
            q = quad[use] + (shift[use] * k)[:, None, :] + self.u(int(use.sum()), 4, 2, lo=-1, hi=1) * 0.003 * OUT_H
            a = self.quad_alpha(q)
            c = (base[use] * (1 + self.u(int(use.sum()), lo=-0.25, hi=0.25)))[:, None] * tint[use]
            img[use] = img[use] * (1 - a) + c[:, :, None, None].clamp(0, 1) * a
        return img

    def finger(self, b: int, quad: torch.Tensor, present: torch.Tensor):
        """A skin-coloured capsule coming in from outside, its tip near a corner or edge."""
        dev = self.device
        which = torch.randint(0, 4, (b,), generator=self.gen, device=dev)
        p0 = quad[torch.arange(b, device=dev), which]
        p1 = quad[torch.arange(b, device=dev), (which + 1) % 4]
        along = torch.where(self.chance(b, 0.6), torch.zeros(b, device=dev), self.u(b, lo=0.1, hi=0.9))
        tip = p0 + (p1 - p0) * along[:, None]
        center = quad.mean(1)
        out = tip - center
        out = out / (out.norm(dim=1, keepdim=True) + 1e-6)
        ang = self.u(b, lo=-0.8, hi=0.8)
        c, s = torch.cos(ang), torch.sin(ang)
        out = torch.stack([out[:, 0] * c - out[:, 1] * s, out[:, 0] * s + out[:, 1] * c], 1)
        card_w = (quad[:, 1] - quad[:, 0]).norm(dim=1)
        radius = card_w * self.u(b, lo=0.11, hi=0.17)  # half a fingertip: 22-34% of card width
        tip = tip + (self.u(b, 2, lo=-1, hi=1) * 0.5 - out * self.u(b, 1, lo=-0.3, hi=0.8)) * radius[:, None]
        end = tip + out * OUT_H * 1.5
        # no card: put the finger anywhere
        anywhere = torch.stack([self.u(b, lo=0, hi=OUT_W), self.u(b, lo=0, hi=OUT_H)], 1)
        tip = torch.where(present[:, None], tip, anywhere)
        end = torch.where(present[:, None], end, anywhere + out * OUT_H * 1.5)
        ab = end - tip
        t = ((self.xx[None] - tip[:, 0, None, None]) * ab[:, 0, None, None] +
             (self.yy[None] - tip[:, 1, None, None]) * ab[:, 1, None, None]) / (ab.pow(2).sum(1)[:, None, None] + 1e-6)
        t = t.clamp(0, 1)
        px = tip[:, 0, None, None] + t * ab[:, 0, None, None]
        py = tip[:, 1, None, None] + t * ab[:, 1, None, None]
        d = torch.sqrt((self.xx[None] - px) ** 2 + (self.yy[None] - py) ** 2)
        r = radius[:, None, None]
        alpha = torch.clamp((r - d) / 1.5 + 0.5, 0, 1)[:, None]
        skin = torch.stack([self.u(b, lo=0.45, hi=0.95), self.u(b, lo=0.3, hi=0.75), self.u(b, lo=0.2, hi=0.65)], 1)
        skin = torch.minimum(skin, skin[:, :1])  # red channel brightest
        shade = (1 - 0.35 * (d / r).clamp(0, 1) ** 2)[:, None]
        return alpha, skin[:, :, None, None] * shade

    def lighting(self, img: torch.Tensor, card_alpha: torch.Tensor) -> torch.Tensor:
        b = img.shape[0]
        # glare spots (35%)
        glare = self.chance(b, 0.35)
        if glare.any():
            for _ in range(2):
                cx = self.u(b, 1, 1, lo=0, hi=OUT_W)
                cy = self.u(b, 1, 1, lo=0, hi=OUT_H)
                r = self.u(b, 1, 1, lo=6, hi=60)
                spot = torch.exp(-((self.xx - cx) ** 2 + (self.yy - cy) ** 2) / (2 * r ** 2))
                k = self.u(b, lo=0.2, hi=0.9) * glare * self.chance(b, 0.7)
                img = img + spot[:, None] * k[:, None, None, None]
        # soft shadow (35%)
        shadow = self.chance(b, 0.35)
        if shadow.any():
            ang = self.u(b, 1, 1, lo=0, hi=2 * math.pi)
            g = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) / OUT_H - self.u(b, 1, 1, lo=-0.3, hi=1.0)
            soft = torch.sigmoid(g / self.u(b, 1, 1, lo=0.01, hi=0.15))
            k = (self.u(b, lo=0.2, hi=0.6) * shadow)[:, None, None]
            img = img * (1 - k * soft)[:, None]
        # exposure, contrast, colour temperature, gamma
        img = img * self.u(b, 1, 1, 1, lo=0.45, hi=1.25)
        mean = img.mean((1, 2, 3), keepdim=True)
        img = (img - mean) * self.u(b, 1, 1, 1, lo=0.7, hi=1.3) + mean
        warm = self.u(b, lo=-0.25, hi=0.25)
        img = img * torch.stack([1 + warm, torch.ones_like(warm), 1 - warm], 1)[:, :, None, None]
        img = img.clamp(0, 1) ** self.u(b, 1, 1, 1, lo=0.75, hi=1.35)
        gray = img.mean(1, keepdim=True)
        img = gray + (img - gray) * self.u(b, 1, 1, 1, lo=0.6, hi=1.3)
        return img.clamp(0, 1)

    def camera(self, img: torch.Tensor) -> torch.Tensor:
        b = img.shape[0]
        # out of focus (45%)
        blur = self.chance(b, 0.45)
        if blur.any():
            sig = self.u(int(blur.sum()), lo=0.3, hi=2.2)
            img[blur] = gaussian_blur2d(img[blur], (9, 9), torch.stack([sig, sig], 1))
        # motion blur (25%)
        mb = self.chance(b, 0.25)
        if mb.any():
            k = int(mb.sum())
            img[mb] = motion_blur(img[mb], 7, self.u(k, lo=0, hi=180), self.u(k, lo=-1, hi=1))
        # sensor noise
        img = img + torch.randn(img.shape, generator=self.gen, device=self.device) * self.u(b, 1, 1, 1, lo=0, hi=0.04)
        img = img.clamp(0, 1)
        # JPEG blockiness (50%)
        jp = self.chance(b, 0.5)
        if jp.any():
            img[jp] = jpeg_codec_differentiable(img[jp], self.u(int(jp.sum()), lo=30, hi=95))
        return img.clamp(0, 1)
