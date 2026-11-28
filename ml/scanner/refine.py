"""Two-pass corner finding: a rough look at the whole frame, then a zoomed-in look.

Why: the corner finder sees a 256 x 384 copy of the frame and marks corners on
a grid 4 times coarser (64 x 96 cells). A card that is 90 px wide in that copy
spans about 22 cells, so one cell is already 4-5% of the card's width, the
go / no-go limit. Cutting a crop around the card from the full-size frame and
running the same model on it makes the card fill about 80% of the picture,
so one cell is about 1.5% of the card.

The browser scanner will do the same: pass 1 on the video frame (or reuse the
last frame's corners while tracking), pass 2 on the crop.
"""

import torch
import torch.nn.functional as F

IN_H, IN_W = 384, 256   # the corner finder's input (portrait)
CARD_FILL = 0.8         # pass 2: the card's longer side fills this share of the crop


def to_input(img: torch.Tensor) -> torch.Tensor:
    """(3, H, W) 0..1 -> (3, 384, 256), stretched like the phone will do."""
    return F.interpolate(img[None], size=(IN_H, IN_W), mode="bilinear", align_corners=False,
                         antialias=True)[0]


def crop_box(quad: torch.Tensor, fill: float = CARD_FILL) -> tuple[float, float, float, float]:
    """A 2:3 portrait box (x0, y0, w, h) in frame pixels around a quad (4, 2) in frame pixels."""
    lo, hi = quad.min(0).values, quad.max(0).values
    cx, cy = ((lo + hi) / 2).tolist()
    bw, bh = (hi - lo).tolist()
    h = max(bh / fill, bw / fill * IN_H / IN_W)
    w = h * IN_W / IN_H
    return cx - w / 2, cy - h / 2, w, h


def cut(img: torch.Tensor, box: tuple[float, float, float, float]) -> torch.Tensor:
    """Cut box from (3, H, W) and resize to the model input; outside the frame repeats the edge."""
    _, H, W = img.shape
    x0, y0, w, h = box
    ys = (y0 + (torch.arange(IN_H, device=img.device) + 0.5) * h / IN_H) / H * 2 - 1
    xs = (x0 + (torch.arange(IN_W, device=img.device) + 0.5) * w / IN_W) / W * 2 - 1
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    grid = torch.stack([gx, gy], -1)[None]
    # shrink first so the sampling doesn't alias when the crop is much bigger than the input
    src = img[None]
    if h / IN_H > 1.5:
        src = F.interpolate(src, scale_factor=IN_H / h, mode="bilinear", align_corners=False, antialias=True)
    return F.grid_sample(src, grid, mode="bilinear", padding_mode="border", align_corners=False)[0]


@torch.no_grad()
def find_corners(model, img: torch.Tensor, passes: int = 2) -> list[dict]:
    """Run the corner finder on a full-size frame (3, H, W), 0..1, on the model's device.

    Returns one dict per pass: corners (4, 2) in frame pixels, present and hidden logits.
    Pass 1 looks at the whole frame; each later pass at a crop around the previous answer.
    """
    _, H, W = img.shape
    out = []
    o = model(to_input(img)[None])
    quad = o["corners"][0] * torch.tensor([W, H], device=img.device, dtype=img.dtype)
    out.append({"corners": quad, "present": o["present"][0], "hidden": o["hidden"][0]})
    for _ in range(passes - 1):
        box = crop_box(quad)
        o = model(cut(img, box)[None])
        x0, y0, w, h = box
        quad = o["corners"][0] * torch.tensor([w, h], device=img.device) + torch.tensor([x0, y0], device=img.device)
        out.append({"corners": quad, "present": o["present"][0], "hidden": o["hidden"][0]})
    return out

