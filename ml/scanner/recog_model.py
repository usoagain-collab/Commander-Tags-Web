"""The card recognizer: EfficientNet-B0 that turns a flat card picture into 128 numbers.

Input (B, 3, 312, 224), 0..1. Output (B, 128), length 1 (a "fingerprint").
Two pictures of the same printing give fingerprints pointing the same way;
the catalog search is a dot product with every printing's fingerprint.

Training (default) uses pairs: each batch holds fake phone photos and the
clean Scryfall pictures of the same printings, and the loss asks each photo's
fingerprint to match its own clean picture more than any other in the batch
(and the other way round). That is exactly the scanner's job: photo against
catalog. ArcFace (one learned direction per printing) is kept as an option,
but with one picture per printing and 115,000 printings it collapsed in the
first real run (Nov 26, 2026: every picture got the same fingerprint).
Only the backbone and the 128-number head ship to the phone.
"""

import math

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
DIM = 128


class RecogNet(nn.Module):
    def __init__(self, pretrained: bool = True, dim: int = DIM):
        super().__init__()
        weights = torchvision.models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        self.features = torchvision.models.efficientnet_b0(weights=weights).features   # 1280 channels
        self.head = nn.Sequential(nn.Dropout(0.2), nn.Linear(1280, dim, bias=False), nn.BatchNorm1d(dim))
        # the batch norm's shift stays at 0: a learned shift lets every fingerprint slide toward one shared
        # direction, the easy way out that both losses took in testing (everything matched everything)
        self.head[2].bias.requires_grad_(False)
        self.register_buffer("mean", MEAN.clone(), persistent=False)
        self.register_buffer("std", STD.clone(), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        f = self.features((x - self.mean) / self.std)
        # generalized-mean pooling (p=3) keeps small sharp details, like the set symbol, better than a plain average
        f = f.clamp(min=1e-6).pow(3).mean((2, 3)).pow(1 / 3)
        return F.normalize(self.head(f), dim=-1)


class ArcFace(nn.Module):
    """Additive angular margin loss over `classes` printings."""

    def __init__(self, classes: int, dim: int = DIM, scale: float = 32.0, margin: float = 0.3):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(classes, dim) * 0.01)
        self.scale, self.margin = scale, margin

    def forward(self, emb: torch.Tensor, labels: torch.Tensor, margin: float | None = None):
        m = self.margin if margin is None else margin
        cos = emb @ F.normalize(self.weight, dim=-1).T                  # (B, C)
        target = cos.gather(1, labels[:, None]).clamp(-1 + 1e-6, 1 - 1e-6)
        theta = torch.acos(target)
        # past 180 degrees the margin would wrap around; fall back to a plain penalty there
        with_margin = torch.where(theta + m < math.pi, torch.cos(theta + m), target - m * math.sin(m))
        logits = cos.scatter(1, labels[:, None], with_margin) * self.scale
        loss = F.cross_entropy(logits, labels)
        acc = (cos.argmax(1) == labels).float().mean()
        return loss, acc


def pair_loss(photos: torch.Tensor, clean: torch.Tensor, temp: float = 0.05):
    """Photo i should match clean picture i more than the batch's other clean pictures, and the other way round.
    Both (B, DIM), length 1. Returns (loss, share of photos whose best match is their own picture)."""
    logits = photos @ clean.T / temp
    labels = torch.arange(len(photos), device=photos.device)
    loss = (F.cross_entropy(logits, labels) + F.cross_entropy(logits.T, labels)) / 2
    acc = (logits.argmax(1) == labels).float().mean()
    return loss, acc
