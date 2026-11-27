"""Fake "straightened card" photos for training the card recognizer, made on the graphics card.

The phone will find the corners, flatten the card to 312 x 224 and ask the
recognizer which printing it is. These fakes copy what that flat picture looks
like after a real photo:

- corners a little off (the corner finder misses by a few % of the card's
  width), so the card sits slightly skewed, shifted or scaled, with a sliver
  of table or sleeve showing at the edges;
- sleeves (a tint and a sheen), foil rainbow, glare spots, shadow, a finger
  over an edge;
- light: haze (lifted blacks), exposure, contrast, a warm colour cast,
  gamma, saturation;
- camera: phone processing (smoothed, then re-sharpened), lost resolution,
  out of focus, motion blur, a little noise, JPEG blockiness.

Tuned Nov 27, 2026 against David's 101 labeled frames, which look hazy and
warm: almost no true black (0.7% of pixels vs 14.5% on the clean picture),
blue always below green (median -0.06), and smooth (phone processing and
video compression remove grain). The first fakes kept deep blacks, swung the
colour both ways and kept grain, and the recognizer trained on them found
the right card in only 28% of real frames against the whole catalog.

Each fake keeps its printing's class number; nothing else is needed.
"""

import math

import torch
import torch.nn.functional as F
from kornia.enhance import jpeg_codec_differentiable
from kornia.filters import gaussian_blur2d, motion_blur
from kornia.geometry.transform import get_perspective_transform, warp_perspective

from scanner.straighten import CARD_H, CARD_W
from scanner.synth import CORNER_RADIUS


def rounded_alpha(h: int, w: int, device) -> torch.Tensor:
    r = CORNER_RADIUS * w
    ys = torch.arange(h, device=device).float() + 0.5
    xs = torch.arange(w, device=device).float() + 0.5
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")
    d = torch.sqrt((xx - xx.clamp(r, w - r)) ** 2 + (yy - yy.clamp(r, h - r)) ** 2)
    return (r - d + 0.5).clamp(0, 1)[None, None]


class RecogSynth:
    def __init__(self, backgrounds: torch.Tensor | None, device="cuda", seed: int | None = None,
                 corner_err: float = 0.045, strength: float = 1.0):
        """backgrounds: (M, H, W, 3) uint8 photos of tables (or None: made-up textures only).

        corner_err: the largest corner miss, as a share of the card's width.
        strength: 0..1 scales how often and how strongly the effects apply
        (training can start gentler).
        """
        self.device = device
        self.bgs = None if backgrounds is None else backgrounds.to(device).permute(0, 3, 1, 2).contiguous()
        self.gen = torch.Generator(device=device)
        if seed is None:
            self.gen.seed()
        else:
            self.gen.manual_seed(seed)
        self.h, self.w = CARD_H, CARD_W
        self.alpha = rounded_alpha(self.h, self.w, device)
        ys = torch.arange(self.h, device=device).float() + 0.5
        xs = torch.arange(self.w, device=device).float() + 0.5
        self.yy, self.xx = torch.meshgrid(ys, xs, indexing="ij")
        self.corner_err = corner_err
        self.strength = strength

    def u(self, *shape, lo=0.0, hi=1.0):
        return lo + (hi - lo) * torch.rand(*shape, generator=self.gen, device=self.device)

    def chance(self, b, p):
        return self.u(b) < p * self.strength

    # ---------- pieces ----------
    def table(self, b: int) -> torch.Tensor:
        """What shows around the card: a background patch, a flat colour, or a sleeve's edge."""
        h, w = self.h, self.w
        flat = self.u(b, 3, 1, 1) * self.u(b, 1, 1, 1, lo=0.1, hi=1.0)
        out = flat.expand(b, 3, h, w).clone()
        if self.bgs is not None:
            use = self.chance(b, 0.7)
            if use.any():
                n = int(use.sum())
                idx = torch.randint(0, self.bgs.shape[0], (n,), generator=self.gen, device=self.device)
                src = self.bgs[idx].float() / 255
                bh, bw = src.shape[2:]
                # random crop about the card's size out of the background frame
                s = self.u(n, lo=0.3, hi=0.9)
                theta = torch.zeros(n, 2, 3, device=self.device)
                theta[:, 0, 0] = (s * (bh * w) / (bw * h)).clamp(max=1.0)   # keep the patch's shape
                theta[:, 1, 1] = s
                theta[:, 0, 2] = self.u(n, lo=-1, hi=1) * (1 - theta[:, 0, 0])
                theta[:, 1, 2] = self.u(n, lo=-1, hi=1) * (1 - s)
                grid = F.affine_grid(theta, (n, 3, h, w), align_corners=False)
                out[use] = F.grid_sample(src, grid, mode="bilinear", padding_mode="reflection", align_corners=False)
        return out

    def misplace(self, b: int) -> torch.Tensor:
        """(b, 4, 2) where the card's corners land in the flat picture when the found corners are off."""
        w, h = self.w, self.h
        rect = torch.tensor([[0, 0], [w, 0], [w, h], [0, h]], device=self.device).float()
        err = self.u(b, 1, 1, lo=0, hi=self.corner_err * self.strength) * w
        q = rect + torch.randn(b, 4, 2, generator=self.gen, device=self.device) * err * 0.6
        # the whole card a bit bigger or smaller (finder drawn to the inner or outer edge) and shifted
        scale = 1 + self.u(b, 1, 1, lo=-1, hi=1) * 0.03 * self.strength
        centre = rect.mean(0)
        q = centre + (q - centre) * scale
        q = q + self.u(b, 1, 2, lo=-1, hi=1) * 0.015 * w * self.strength
        return q

    # ---------- the whole fake ----------
    @torch.no_grad()
    def __call__(self, cards: torch.Tensor) -> torch.Tensor:
        """cards: (B, 3, 312, 224) float 0..1 clean card pictures -> fakes, same shape."""
        b, dev = cards.shape[0], self.device
        h, w = self.h, self.w
        cards = cards.to(dev)
        if cards.shape[2:] != (h, w):
            cards = F.interpolate(cards, size=(h, w), mode="bilinear", align_corners=False, antialias=True)

        # foil rainbow on the card itself (20%)
        foil = self.chance(b, 0.1)
        if foil.any():
            ang = self.u(b, 1, 1, lo=0, hi=math.pi)
            ph = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) * self.u(b, 1, 1, lo=0.01, hi=0.05)
            rainbow = torch.stack([torch.sin(ph), torch.sin(ph + 2.1), torch.sin(ph + 4.2)], 1) * 0.5 + 0.5
            k = (self.u(b, lo=0.05, hi=0.2) * foil)[:, None, None, None]
            cards = cards * (1 - k) + rainbow * k

        # place the card where slightly wrong corners would put it, over the table
        src = torch.tensor([[0, 0], [w, 0], [w, h], [0, h]], device=dev).float().expand(b, 4, 2)
        M = get_perspective_transform(src, self.misplace(b))
        rgba = torch.cat([cards, self.alpha.expand(b, 1, h, w)], 1)
        warped = warp_perspective(rgba, M, dsize=(h, w), mode="bilinear", padding_mode="zeros", align_corners=False)
        a = warped[:, 3:4]
        img = self.table(b) * (1 - a) + warped[:, :3] * a

        # sleeve (35%): a tint over everything and a sheen band
        sleeve = self.chance(b, 0.35)
        if sleeve.any():
            # sleeves are mostly clear or matte: a near-gray tint, not a strong colour
            tint = self.u(b, 1, 1, 1, lo=0.3, hi=0.9) + self.u(b, 3, 1, 1, lo=-0.08, hi=0.08)
            k = (self.u(b, lo=0.03, hi=0.15) * sleeve)[:, None, None, None]
            img = img * (1 - k) + tint * k
        sheen = self.chance(b, 0.4)
        if sheen.any():
            ang = self.u(b, 1, 1, lo=0, hi=2 * math.pi)
            g = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) / h
            band = torch.exp(-((g - self.u(b, 1, 1, lo=-0.5, hi=1.2)) / self.u(b, 1, 1, lo=0.05, hi=0.3)) ** 2)
            img = img + band[:, None] * (self.u(b, lo=0.05, hi=0.4) * sheen)[:, None, None, None]

        # glare spots (30%)
        glare = self.chance(b, 0.3)
        if glare.any():
            cx, cy = self.u(b, 1, 1, lo=0, hi=w), self.u(b, 1, 1, lo=0, hi=h)
            r = self.u(b, 1, 1, lo=5, hi=70)
            spot = torch.exp(-((self.xx - cx) ** 2 + (self.yy - cy) ** 2) / (2 * r ** 2))
            img = img + spot[:, None] * (self.u(b, lo=0.2, hi=0.9) * glare)[:, None, None, None]

        # finger over an edge (12%)
        finger = self.chance(b, 0.12)
        if finger.any():
            side = torch.randint(0, 4, (b,), generator=self.gen, device=dev)
            t = self.u(b, lo=0.1, hi=0.9)
            ex = torch.where(side == 1, torch.full_like(t, float(w)), torch.where(side == 3, torch.zeros_like(t), t * w))
            ey = torch.where(side == 2, torch.full_like(t, float(h)), torch.where(side == 0, torch.zeros_like(t), t * h))
            r = self.u(b, lo=0.06, hi=0.12) * w
            d = torch.sqrt((self.xx - ex[:, None, None]) ** 2 + (self.yy - ey[:, None, None]) ** 2)
            fa = ((r[:, None, None] - d) / 2 + 0.5).clamp(0, 1)[:, None] * finger[:, None, None, None]
            skin = torch.stack([self.u(b, lo=0.45, hi=0.95), self.u(b, lo=0.3, hi=0.75), self.u(b, lo=0.2, hi=0.65)], 1)
            skin = torch.minimum(skin, skin[:, :1])[:, :, None, None]
            img = img * (1 - fa) + skin * fa

        # shadow (30%)
        shadow = self.chance(b, 0.3)
        if shadow.any():
            ang = self.u(b, 1, 1, lo=0, hi=2 * math.pi)
            g = (self.xx * torch.cos(ang) + self.yy * torch.sin(ang)) / h - self.u(b, 1, 1, lo=-0.3, hi=1.0)
            soft = torch.sigmoid(g / self.u(b, 1, 1, lo=0.01, hi=0.2))
            img = img * (1 - (self.u(b, lo=0.2, hi=0.55) * shadow)[:, None, None] * soft)[:, None]

        # light
        s = self.strength
        # haze (70%): stray light in the lens or a lit room lifts the blacks toward a soft warm gray;
        # sometimes heavy (a white card that nearly disappears)
        haze = self.chance(b, 0.7)
        if haze.any():
            k = torch.where(self.u(b) < 0.06, self.u(b, lo=0.35, hi=0.55), self.u(b, lo=0.08, hi=0.32)) * haze
            level = self.u(b, lo=0.4, hi=0.8)
            fog = torch.stack([level * 1.04, level, level * 0.9], 1)[:, :, None, None]
            img = img * (1 - k[:, None, None, None]) + fog * k[:, None, None, None]
        img = img * self.u(b, 1, 1, 1, lo=1 - 0.4 * s, hi=1 + 0.2 * s)
        mean = img.mean((1, 2, 3), keepdim=True)
        img = (img - mean) * self.u(b, 1, 1, 1, lo=1 - 0.3 * s, hi=1 + 0.15 * s) + mean
        # colour: indoor light is warm, so blue sits below green nearly always; a few fakes stay neutral-ish
        warm_side = self.u(b) < 0.85
        blue = torch.where(warm_side, self.u(b, lo=-0.12, hi=-0.02), self.u(b, lo=-0.04, hi=0.04)) * s
        red = torch.where(warm_side, self.u(b, lo=0.0, hi=0.06), self.u(b, lo=-0.03, hi=0.03)) * s
        img = img + torch.stack([red, torch.zeros_like(red), blue], 1)[:, :, None, None]
        img = img.clamp(0, 1) ** self.u(b, 1, 1, 1, lo=1 - 0.25 * s, hi=1 + 0.35 * s)
        gray = img.mean(1, keepdim=True)
        img = (gray + (img - gray) * self.u(b, 1, 1, 1, lo=1 - 0.4 * s, hi=1 + 0.3 * s)).clamp(0, 1)

        # camera: lost resolution (60%), phone processing (65%), out of focus (25%), motion blur (15%),
        # a little noise (30%), JPEG (75%)
        lowres = self.chance(b, 0.6)
        if lowres.any():
            f = float(self.u(1, lo=0.35, hi=0.8))
            small = F.interpolate(img[lowres], scale_factor=f, mode="bilinear", align_corners=False, antialias=True)
            img[lowres] = F.interpolate(small, size=(h, w), mode="bilinear", align_corners=False)
        phone = self.chance(b, 0.65)
        if phone.any():
            n = int(phone.sum())
            sig = self.u(n, lo=0.6, hi=1.3)
            soft = gaussian_blur2d(img[phone], (7, 7), torch.stack([sig, sig], 1))
            # noise reduction smooths grain away, then the phone sharpens the edges back a little
            edge = soft - gaussian_blur2d(soft, (7, 7), torch.stack([sig * 1.5, sig * 1.5], 1))
            img[phone] = soft + edge * self.u(n, 1, 1, 1, lo=0.2, hi=0.8)
        blur = self.chance(b, 0.25)
        if blur.any():
            sig = self.u(int(blur.sum()), lo=0.4, hi=1.8)
            img[blur] = gaussian_blur2d(img[blur], (9, 9), torch.stack([sig, sig], 1))
        mb = self.chance(b, 0.15)
        if mb.any():
            n = int(mb.sum())
            img[mb] = motion_blur(img[mb], 7, self.u(n, lo=0, hi=180), self.u(n, lo=-1, hi=1))
        noisy = self.chance(b, 0.3)[:, None, None, None]
        img = img + torch.randn(img.shape, generator=self.gen, device=dev) * self.u(b, 1, 1, 1, lo=0, hi=0.02 * s) * noisy
        img = img.clamp(0, 1)
        jp = self.chance(b, 0.75)
        if jp.any():
            img[jp] = jpeg_codec_differentiable(img[jp], self.u(int(jp.sum()), lo=35, hi=95))
        return img.clamp(0, 1)
