"""
生成扩展图标：深色圆角底 + 新月。

不依赖 Pillow，直接用 zlib 手写 PNG，避免为几张图去装第三方包。
用法：python tools/make_icons.py
"""

import math
import os
import struct
import zlib

SS = 4  # 每个方向的超采样倍数，用于抗锯齿

BG = (27, 31, 41)
EDGE = (58, 65, 82)
MOON = (255, 196, 92)

CORNER = 0.22


def inside_round_rect(u, v, x0, y0, x1, y1, radius):
    if u < x0 or u > x1 or v < y0 or v > y1:
        return False
    r = min(radius, (x1 - x0) / 2.0, (y1 - y0) / 2.0)
    cx = min(max(u, x0 + r), x1 - r)
    cy = min(max(v, y0 + r), y1 - r)
    dx = u - cx
    dy = v - cy
    return dx * dx + dy * dy <= r * r


def dist(u, v, cx, cy):
    return math.hypot(u - cx, v - cy)


def sample(u, v):
    """返回该采样点的颜色，alpha 为 0 表示完全透明。"""
    if not inside_round_rect(u, v, 0.0, 0.0, 1.0, 1.0, CORNER):
        return (0, 0, 0, 0)

    # 外圈一层细描边，深色背景下更容易分辨边界
    if not inside_round_rect(u, v, 0.055, 0.055, 0.945, 0.945, CORNER - 0.04):
        return EDGE + (255,)

    # 新月：大圆减去一个偏右上的圆
    if dist(u, v, 0.485, 0.535) <= 0.265 and dist(u, v, 0.625, 0.425) > 0.235:
        return MOON + (255,)

    # 右上角一颗小星
    if dist(u, v, 0.795, 0.235) <= 0.042:
        return MOON + (255,)

    return BG + (255,)


def render(size):
    total = size * size
    acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(total)]
    samples = SS * SS

    for py in range(size * SS):
        oy = py // SS
        v = (py + 0.5) / (size * SS)
        for px in range(size * SS):
            ox = px // SS
            u = (px + 0.5) / (size * SS)
            r, g, b, a = sample(u, v)
            bucket = acc[oy * size + ox]
            bucket[0] += r
            bucket[1] += g
            bucket[2] += b
            bucket[3] += a

    out = bytearray(total * 4)
    for i, bucket in enumerate(acc):
        a_sum = bucket[3]
        if a_sum <= 0:
            continue
        # a_sum 是未归一化的累加值（每个采样点贡献 0 或 255）
        coverage = a_sum / (255.0 * samples)
        if coverage <= 0.004:
            continue
        # 非透明采样点的颜色均值
        out[i * 4 + 0] = int(round(bucket[0] * 255.0 / a_sum)) & 0xFF
        out[i * 4 + 1] = int(round(bucket[1] * 255.0 / a_sum)) & 0xFF
        out[i * 4 + 2] = int(round(bucket[2] * 255.0 / a_sum)) & 0xFF
        out[i * 4 + 3] = int(round(coverage * 255)) & 0xFF
    return bytes(out)


def write_png(path, size, pixels):
    raw = b"".join(
        b"\x00" + pixels[y * size * 4 : (y + 1) * size * 4] for y in range(size)
    )

    def chunk(tag, data):
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="生成扩展图标（深色圆角底 + 新月）")
    parser.add_argument("--size", type=int, default=0, help="只生成一张，指定边长")
    parser.add_argument("--out", default="", help="配合 --size 指定完整输出路径")
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 单张模式：商店要求的 300x300 图标不走 icons/，避免混进扩展包
    if args.size and args.out:
        out_path = args.out if os.path.isabs(args.out) else os.path.join(root, args.out)
        parent = os.path.dirname(out_path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        pixels = render(args.size)
        write_png(out_path, args.size, pixels)
        print("[生成] %s (%d x %d, %d 字节)"
              % (out_path, args.size, args.size, os.path.getsize(out_path)))
        return

    out_dir = os.path.join(root, "icons")
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    for size in (16, 32, 48, 128):
        pixels = render(size)
        path = os.path.join(out_dir, "icon%d.png" % size)
        write_png(path, size, pixels)
        print("[生成] %s (%d x %d, %d 字节)" % (path, size, size, os.path.getsize(path)))


if __name__ == "__main__":
    main()
