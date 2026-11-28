"""Snap rough corners onto the card by lining the photo up with the card's own clean picture.

Once the recognizer has a guess, we know what the card should look like. So
instead of hunting for edges (which blanket patterns and the black border's
inner edge fool, see refine.py's history), move the 4 corners until the
flattened photo matches the clean Scryfall picture as closely as possible.

How: the corners are 8 numbers (offsets in the flat card's pixels). The photo
is flattened with them, both pictures go to gray and are compared by
correlation (insensitive to brightness, contrast, haze and colour casts),
plus correlation of their edges (so flat areas don't dominate). Gradient
descent moves the corners, coarse to fine (a small flat picture first, then
bigger ones), from the corner finder's answer.

Uses:
- better corners for the recognizer and the corner reading once a card is
  guessed (it needs the right guess, so it runs on the top few candidates);
- the match itself says whether a guess is right: a wrong card's picture
  never lines up well;
- automatic corner labels for training the corner finder on real frames
  when the printing is known (clip names from the shoot).
"""

import torch
import torch.nn.functional as F

from scanner.straighten import CARD_H, CARD_W

LEVELS = ((78, 56), (156, 112), (312, 224))


def homography(src: torch.Tensor, dst: torch.Tensor) -> torch.Tensor:
    """(B, 4, 2) -> (B, 3, 3) mapping src to dst; differentiable."""
    b = src.shape[0]
    x, y = src[..., 0], src[..., 1]
    u, v = dst[..., 0], dst[..., 1]
    z, o = torch.zeros_like(x), torch.ones_like(x)
    a1 = torch.stack([x, y, o, z, z, z, -u * x, -u * y], -1)
    a2 = torch.stack([z, z, z, x, y, o, -v * x, -v * y], -1)
    A = torch.cat([a1, a2], 1)                    # (B, 8, 8)
    rhs = torch.cat([u, v], 1)[..., None]         # (B, 8, 1)
    h = torch.linalg.solve(A, rhs)[..., 0]
    return torch.cat([h, torch.ones(b, 1, device=h.device, dtype=h.dtype)], 1).view(b, 3, 3)


def apply_h(H: torch.Tensor, pts: torch.Tensor) -> torch.Tensor:
    """(B, 3, 3), (B, N, 2) -> (B, N, 2)."""
    p = torch.cat([pts, torch.ones_like(pts[..., :1])], -1) @ H.transpose(1, 2)
    return p[..., :2] / p[..., 2:3]


def rect(h: int, w: int, device) -> torch.Tensor:
    return torch.tensor([[0, 0], [w, 0], [w, h], [0, h]], dtype=torch.float32, device=device)


def gray(x: torch.Tensor) -> torch.Tensor:
    return (x * torch.tensor([0.299, 0.587, 0.114], device=x.device).view(1, 3, 1, 1)).sum(1, keepdim=True)


def zncc(a: torch.Tensor, b: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Correlation of a and b (B, 1, h, w) inside mask (1, 1, h, w); -1..1 per picture."""
    m = mask.sum()
    am = (a * mask).sum((1, 2, 3), keepdim=True) / m
    bm = (b * mask).sum((1, 2, 3), keepdim=True) / m
    a, b = (a - am) * mask, (b - bm) * mask
    return (a * b).sum((1, 2, 3)) / ((a * a).sum((1, 2, 3)).sqrt() * (b * b).sum((1, 2, 3)).sqrt() + 1e-6)


def edges(x: torch.Tensor) -> torch.Tensor:
    gx = x[..., :, 2:] - x[..., :, :-2]
    gy = x[..., 2:, :] - x[..., :-2, :]
    return (gx[..., 1:-1, :] ** 2 + gy[..., :, 1:-1] ** 2 + 1e-6).sqrt()


def blur(x: torch.Tensor, s: float) -> torch.Tensor:
    k = int(s * 3) * 2 + 1
    t = torch.arange(k, device=x.device, dtype=x.dtype) - k // 2
    g = torch.exp(-t ** 2 / (2 * s * s))
    g = g / g.sum()
    x = F.conv2d(F.pad(x, (k // 2, k // 2, 0, 0), mode="replicate"), g.view(1, 1, 1, k))
    return F.conv2d(F.pad(x, (0, 0, k // 2, k // 2), mode="replicate"), g.view(1, 1, k, 1))


def score(warped: torch.Tensor, tmpl: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Match of flat photos and clean pictures, both (B, 1, h, w) gray: intensity and edge correlation."""
    m_in = mask[..., 1:-1, 1:-1]
    return 0.5 * zncc(warped, tmpl, mask) + 0.5 * zncc(edges(warped), edges(tmpl), m_in)


def pyramid(frame: torch.Tensor, card_width: float) -> list[tuple[torch.Tensor, float]]:
    """For each level, the frame (gray, 1, 1, H, W) shrunk so the card is about 1.3 x the level's width."""
    g = gray(frame[None])
    out = []
    for _, w in LEVELS:
        f = min(1.0, 1.3 * w / card_width)
        out.append((F.interpolate(g, scale_factor=f, mode="bilinear", align_corners=False, antialias=True)
                    if f < 1 else g, f))
    return out


def sample(img: torch.Tensor, H: torch.Tensor, h: int, w: int) -> torch.Tensor:
    """Flatten: for each pixel of an (h, w) flat card, read img (B or 1, 1, Hi, Wi) at H(pixel)."""
    b = H.shape[0]
    ys = torch.arange(h, device=H.device, dtype=H.dtype) + 0.5
    xs = torch.arange(w, device=H.device, dtype=H.dtype) + 0.5
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")
    pts = torch.stack([xx, yy], -1).view(1, -1, 2).expand(b, -1, -1)
    q = apply_h(H, pts)
    Hi, Wi = img.shape[-2:]
    grid = torch.stack([q[..., 0] / Wi * 2 - 1, q[..., 1] / Hi * 2 - 1], -1).view(b, h, w, 2)
    return F.grid_sample(img.expand(b, -1, -1, -1), grid, mode="bilinear", padding_mode="border", align_corners=False)


def card_mask(h: int, w: int, device, inset: float = 0.03) -> torch.Tensor:
    """Compare inside the card only, a little in from the edge (rounded corners, sleeve edges)."""
    m = torch.zeros(1, 1, h, w, device=device)
    dy, dx = max(1, int(h * inset)), max(1, int(w * inset))
    m[..., dy:h - dy, dx:w - dx] = 1
    return m


def align(frame: torch.Tensor, quad: torch.Tensor, templates: torch.Tensor, iters: tuple = (60, 40, 25),
          lr: float = 0.004) -> tuple[torch.Tensor, torch.Tensor]:
    """Line the photo up with each clean picture.

    frame (3, H, W) 0..1; quad (4, 2) rough corners in frame pixels (card's order);
    templates (B, 3, 312, 224) 0..1, clean pictures of the candidates.
    Returns (corners (B, 4, 2) frame pixels, one per candidate; match score (B,), about -1..1).
    """
    dev = frame.device
    b = templates.shape[0]
    quad = quad.to(dev).float()
    width = float(((quad[1] - quad[0]).norm() + (quad[2] - quad[3]).norm()) / 2)
    pyr = pyramid(frame, width)
    big = rect(CARD_H, CARD_W, dev)
    H0 = homography(big[None], quad[None])                       # flat (312 x 224 units) -> frame
    # corner offsets in card widths, in the flat card's frame of reference
    d = torch.zeros(b, 4, 2, device=dev, requires_grad=True)
    tg = gray(templates.to(dev).float())
    for (h, w), (img, f), n in zip(LEVELS, pyr, iters):
        t = blur(F.interpolate(tg, size=(h, w), mode="bilinear", align_corners=False, antialias=True), 0.7)
        mask = card_mask(h, w, dev)
        small = rect(h, w, dev)
        opt = torch.optim.Adam([d], lr=lr)
        for _ in range(n):
            corners = apply_h(H0.expand(b, -1, -1), big[None] + d * CARD_W) * f   # in this level's pixels
            H = homography(small[None].expand(b, -1, -1), corners)
            loss = -score(blur(sample(img, H, h, w), 0.7), t, mask).sum()
            opt.zero_grad()
            loss.backward()
            opt.step()
    with torch.no_grad():
        corners = apply_h(H0.expand(b, -1, -1), big[None] + d * CARD_W)
        h, w = LEVELS[-1]
        img, f = pyr[-1]
        H = homography(rect(h, w, dev)[None].expand(b, -1, -1), corners * f)
        final = score(blur(sample(img, H, h, w), 0.7), blur(tg, 0.7), card_mask(h, w, dev))
    return corners.detach(), final
