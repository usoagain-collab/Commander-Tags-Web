"""Cut a card out of a photo and flatten it to the recognizer's input size.

The corners are in frame pixels, in the card's own order (top-left as the card
reads, then clockwise), as the corner finder and the labels give them, so the
result is always upright.
"""

import torch
import torch.nn.functional as F
from kornia.geometry.transform import get_perspective_transform, warp_perspective

CARD_H, CARD_W = 312, 224   # recognizer input, about a Magic card's 88 x 63 mm shape


@torch.no_grad()
def straighten(img: torch.Tensor, quad: torch.Tensor, size: tuple[int, int] = (CARD_H, CARD_W)) -> torch.Tensor:
    """img (3, H, W) 0..1, quad (4, 2) frame pixels -> (3, h, w) flat card."""
    h, w = size
    width = float(((quad[1] - quad[0]).norm() + (quad[2] - quad[3]).norm()) / 2)
    src = img[None]
    q = quad
    # shrink a big frame first so the warp doesn't skip pixels (moire on fine print)
    if width > 1.5 * w:
        f = 1.2 * w / width
        src = F.interpolate(src, scale_factor=f, mode="bilinear", align_corners=False, antialias=True)
        q = quad * f
    dst = torch.tensor([[0, 0], [w, 0], [w, h], [0, h]], dtype=q.dtype, device=q.device)
    M = get_perspective_transform(q[None], dst[None])
    return warp_perspective(src, M, dsize=(h, w), mode="bilinear", padding_mode="border",
                            align_corners=False)[0].clamp(0, 1)
