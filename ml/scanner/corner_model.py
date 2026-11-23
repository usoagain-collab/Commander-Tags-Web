"""The corner finder: MobileNetV3-Small with a small heatmap head.

Input: a (B, 3, 384, 256) photo, 0..1. Output:
- corners (B, 4, 2), 0..1 of the image width and height, in the card's own
  order (top-left as the card reads, then clockwise);
- present (B,) logit: is there a card;
- hidden (B, 4) logits: is that corner covered;
- heat (B, 4, 96, 64) heatmap logits (training only).

Each corner gets its own heatmap at a quarter of the input size; the corner's
position is the heatmap's weighted average ("soft-argmax"), which gives
positions finer than one heatmap cell and trains smoothly.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def conv_bn(cin: int, cout: int, k: int = 1) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(cin, cout, k, padding=k // 2, bias=False),
                         nn.BatchNorm2d(cout), nn.ReLU(inplace=True))


class CornerNet(nn.Module):
    def __init__(self, pretrained: bool = True, width: int = 64):
        super().__init__()
        weights = torchvision.models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        feats = torchvision.models.mobilenet_v3_small(weights=weights).features
        # stride 4 (16 ch), 8 (24), 16 (48), 32 (576)
        self.s4, self.s8, self.s16, self.s32 = feats[:2], feats[2:4], feats[4:9], feats[9:]
        self.l4, self.l8 = conv_bn(16, width), conv_bn(24, width)
        self.l16, self.l32 = conv_bn(48, width), conv_bn(576, width)
        self.smooth = nn.Sequential(conv_bn(width, width, 3), conv_bn(width, width, 3))
        self.heat = nn.Conv2d(width, 4, 1)
        self.cls = nn.Sequential(nn.Linear(576, 128), nn.ReLU(inplace=True), nn.Linear(128, 5))
        self.register_buffer("mean", MEAN.clone(), persistent=False)
        self.register_buffer("std", STD.clone(), persistent=False)

    def forward(self, x: torch.Tensor):
        x = (x - self.mean) / self.std
        f4 = self.s4(x)
        f8 = self.s8(f4)
        f16 = self.s16(f8)
        f32 = self.s32(f16)
        p = self.l32(f32)
        p = F.interpolate(p, size=f16.shape[2:], mode="bilinear", align_corners=False) + self.l16(f16)
        p = F.interpolate(p, size=f8.shape[2:], mode="bilinear", align_corners=False) + self.l8(f8)
        p = F.interpolate(p, size=f4.shape[2:], mode="bilinear", align_corners=False) + self.l4(f4)
        heat = self.heat(self.smooth(p))
        corners = soft_argmax(heat)
        logits = self.cls(f32.mean((2, 3)))
        return {"corners": corners, "present": logits[:, 0], "hidden": logits[:, 1:], "heat": heat}


def soft_argmax(heat: torch.Tensor) -> torch.Tensor:
    """(B, K, h, w) logits -> (B, K, 2) positions, 0..1 of width and height (cell centres)."""
    b, k, h, w = heat.shape
    p = heat.flatten(2).softmax(-1).view(b, k, h, w)
    xs = (torch.arange(w, device=heat.device, dtype=heat.dtype) + 0.5) / w
    ys = (torch.arange(h, device=heat.device, dtype=heat.dtype) + 0.5) / h
    x = (p.sum(2) * xs).sum(-1)
    y = (p.sum(3) * ys).sum(-1)
    return torch.stack([x, y], -1)


def gaussian_targets(corners: torch.Tensor, h: int, w: int, sigma: float = 1.5) -> torch.Tensor:
    """(B, 4, 2) positions 0..1 -> (B, 4, h, w) target distributions (sum 1)."""
    xs = torch.arange(w, device=corners.device).float() + 0.5
    ys = torch.arange(h, device=corners.device).float() + 0.5
    cx = corners[..., 0, None, None] * w
    cy = corners[..., 1, None, None] * h
    g = torch.exp(-((xs - cx) ** 2 + (ys[:, None] - cy) ** 2) / (2 * sigma ** 2))
    return g / (g.flatten(2).sum(-1)[..., None, None] + 1e-8)


def corner_loss(out: dict, present: torch.Tensor, corners: torch.Tensor, hidden: torch.Tensor,
                img_w: int, img_h: int) -> tuple[torch.Tensor, dict]:
    """corners in pixels. Position error is measured in image-width units for both axes."""
    target = corners / torch.tensor([img_w, img_h], device=corners.device)
    m = present > 0.5
    loss_present = F.binary_cross_entropy_with_logits(out["present"], present)
    if m.any():
        scale = torch.tensor([1.0, img_h / img_w], device=corners.device)
        err = ((out["corners"][m] - target[m]) * scale).abs()
        loss_xy = err.mean()
        heat = out["heat"][m]
        tgt = gaussian_targets(target[m], heat.shape[2], heat.shape[3])
        loss_heat = -(tgt * heat.flatten(2).log_softmax(-1).view_as(heat)).sum((2, 3)).mean()
        loss_hidden = F.binary_cross_entropy_with_logits(out["hidden"][m], hidden[m])
    else:
        loss_xy = loss_heat = loss_hidden = out["corners"].sum() * 0
    total = 10 * loss_xy + 0.1 * loss_heat + loss_present + 0.3 * loss_hidden
    return total, {"xy": loss_xy.item(), "heat": loss_heat.item(),
                   "present": loss_present.item(), "hidden": loss_hidden.item()}


def corner_error(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Mean corner distance as a share of the card's width, per sample. Both (B, 4, 2) in pixels."""
    width = ((target[:, 1] - target[:, 0]).norm(dim=-1) + (target[:, 2] - target[:, 3]).norm(dim=-1)) / 2
    return (pred - target).norm(dim=-1) / width[:, None]
