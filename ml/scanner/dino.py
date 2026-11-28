"""Meta's DINOv2 ViT-S/14 (Apache 2.0), frozen, as the recognizer's backbone.

Since Nov 27, 2026 the recognizer is DINOv2 plus a small trained head
(scanner/dino_head.py). The backbone never trains, so its features for any
picture are worked out once and cached: the clean catalog pictures
(runs/recog-v3/compare/dino_catalog.npz), fake photos (build_dino_fakes.py)
and David's frames.

Features per picture: the CLS token and the mean of the patch tokens, each
L2-normalized, 384 numbers each. Input is the flat card at 312 x 224, resized
to 308 x 224 (a multiple of the 14-pixel patch).

On this laptop's GTX 1660 Ti it runs at about 112 pictures a second in full
precision; half precision is 3 times slower on this card.
"""

import os
from pathlib import Path

import torch
import torch.nn.functional as F

HUB = Path(os.path.expanduser("~/.cache/torch/hub/facebookresearch_dinov2_main"))
IN_H, IN_W = 308, 224
DIM = 384
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def load_backbone(device="cuda"):
    """The frozen backbone. Uses the local torch hub copy when there is one (no network)."""
    if HUB.exists():
        m = torch.hub.load(str(HUB), "dinov2_vits14", source="local")
    else:
        m = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14", trust_repo=True)
    m = m.to(device).eval()
    for p in m.parameters():
        p.requires_grad_(False)
    return m


@torch.no_grad()
def features(model, x: torch.Tensor) -> torch.Tensor:
    """x (B, 3, H, W) 0..1 on the model's device -> (B, 2, 384): normalized CLS, normalized patch mean."""
    x = F.interpolate(x, size=(IN_H, IN_W), mode="bilinear", align_corners=False, antialias=True)
    out = model.forward_features((x - MEAN.to(x.device)) / STD.to(x.device))
    return torch.stack([F.normalize(out["x_norm_clstoken"], dim=-1),
                        F.normalize(out["x_norm_patchtokens"].mean(1), dim=-1)], 1)


@torch.no_grad()
def features_of(model, imgs: torch.Tensor, device, bs: int = 64) -> torch.Tensor:
    """(N, 3, H, W) on the CPU -> (N, 2, 384) on the CPU."""
    out = [features(model, imgs[i:i + bs].to(device)).cpu() for i in range(0, len(imgs), bs)]
    return torch.cat(out) if out else torch.zeros(0, 2, DIM)
