"""One-minute check that training runs on the graphics card.

Trains a small MobileNetV3 (the size of the planned corner finder) on random
256 x 256 pictures for about a minute and prints images per second. The
pictures are random noise, so the model learns nothing useful; this only
measures speed and proves the GPU, CUDA and PyTorch work together.

Lesson from the first run (Nov 22, 2026, GTX 1660 Ti): the "channels_last"
memory layout, which speeds up newer cards, made this one about 8 times
slower (107 vs 845 images/s), and half precision was a little slower than
full precision (the 16-series has no tensor cores). So the default is plain
full precision; --fp16 tries half precision.

Run:  uv run python scripts/gpu_check.py [--seconds 60]
"""

import argparse
import time

import torch
import torchvision


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--fp16", action="store_true", help="mixed precision (slower on GTX 16-series)")
    args = parser.parse_args()

    print(f"PyTorch {torch.__version__}, CUDA build {torch.version.cuda}")
    if not torch.cuda.is_available():
        print("No CUDA graphics card found: training would run on the processor (far too slow).")
        raise SystemExit(1)

    device = torch.device("cuda")
    props = torch.cuda.get_device_properties(0)
    print(f"GPU: {props.name}, {props.total_memory / 2**30:.1f} GB, compute {props.major}.{props.minor}")

    torch.backends.cudnn.benchmark = True
    model = torchvision.models.mobilenet_v3_small(num_classes=10).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    scaler = torch.amp.GradScaler("cuda", enabled=args.fp16)
    loss_fn = torch.nn.CrossEntropyLoss()

    x = torch.randn(args.batch, 3, 256, 256, device=device)
    y = torch.randint(0, 10, (args.batch,), device=device)

    def step() -> float:
        opt.zero_grad(set_to_none=True)
        with torch.autocast("cuda", dtype=torch.float16, enabled=args.fp16):
            loss = loss_fn(model(x), y)
        scaler.scale(loss).backward()
        scaler.step(opt)
        scaler.update()
        return loss

    print("Warming up...")
    for _ in range(10):
        step()
    torch.cuda.synchronize()

    print(f"Training for {args.seconds:.0f} s at batch {args.batch}...")
    start = time.perf_counter()
    last_report = start
    images = 0
    while True:
        step()
        images += args.batch
        now = time.perf_counter()
        if now - last_report >= 10:
            torch.cuda.synchronize()
            now = time.perf_counter()
            print(f"  {now - start:5.0f} s: {images / (now - start):7.0f} images/s")
            last_report = now
        if now - start >= args.seconds:
            break
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - start

    rate = images / elapsed
    print()
    print(f"GPU: {props.name}")
    precision = "half" if args.fp16 else "full"
    print(f"Images per second (MobileNetV3-Small, 256 x 256, {precision} precision): {rate:.0f}")
    print(f"Peak GPU memory: {torch.cuda.max_memory_allocated() / 2**30:.2f} GB")
    print(f"200,000 training pictures would take about {200_000 / rate / 60:.0f} minutes per pass.")


if __name__ == "__main__":
    main()
