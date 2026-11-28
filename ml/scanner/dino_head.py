"""A small head on top of frozen DINOv2 features (scanner/dino.py).

Input: the CLS token and the patch mean, each 384 numbers, both normalized.
Output: a 384-number fingerprint, normalized. The same head runs on the phone
photo and on every clean catalog picture, so the catalog is rebuilt from the
cached clean features in seconds after training.

It starts as "the CLS token, unchanged": the last layer begins at zero and the
head only adds a correction. So before training it scores exactly what
untrained DINOv2 scored (76.2% right card on hand corners), and training can
only move it from there.

On the phone it is two small matrix multiplies after the backbone (about
1.2 million numbers, 2.4 MB at half precision), exported in the same ONNX file.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

DIM = 384


class DinoHead(nn.Module):
    def __init__(self, hidden: int = 1024, dropout: float = 0.1):
        super().__init__()
        self.net = nn.Sequential(nn.LayerNorm(2 * DIM), nn.Linear(2 * DIM, hidden), nn.GELU(),
                                 nn.Dropout(dropout), nn.Linear(hidden, DIM))
        nn.init.zeros_(self.net[-1].weight)
        nn.init.zeros_(self.net[-1].bias)

    def forward(self, f: torch.Tensor) -> torch.Tensor:
        """f (B, 2, 384) -> (B, 384), length 1."""
        f = f.float()
        return F.normalize(f[:, 0] + self.net(f.flatten(1)), dim=-1)

    @torch.no_grad()
    def embed(self, f: torch.Tensor, bs: int = 16384) -> torch.Tensor:
        """Many feature rows, in chunks (eval mode is the caller's job)."""
        return torch.cat([self(f[i:i + bs]) for i in range(0, len(f), bs)])
