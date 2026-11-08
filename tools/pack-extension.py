"""
把本扩展打包成可上传商店的 zip。

只收运行必需的文件：manifest.json + src/ + icons/ + README.md + LICENSE。
test/、tools/、package.json 不进包，避免使用者在扩展目录里看到一堆无关文件。

版本号从 manifest.json 读取，不在这里另写一份，避免两处不一致。

用法：python tools/pack-extension.py
产物：dist/fin-extension-<version>.zip
"""

import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, "dist")

INCLUDE_DIRS = ["src", "icons"]
INCLUDE_FILES = ["manifest.json", "README.md", "LICENSE"]


def main():
    manifest_path = os.path.join(PROJECT, "manifest.json")
    if not os.path.isfile(manifest_path):
        raise SystemExit("找不到 manifest.json：%s" % manifest_path)

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    version = manifest.get("version", "1.0.0")
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "fin-extension-%s.zip" % version)

    count = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in INCLUDE_FILES:
            full = os.path.join(PROJECT, name)
            if os.path.isfile(full):
                z.write(full, name)
                count += 1
        for folder in INCLUDE_DIRS:
            base = os.path.join(PROJECT, folder)
            if not os.path.isdir(base):
                continue
            for dirpath, _, files in os.walk(base):
                for fn in sorted(files):
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, PROJECT).replace("\\", "/")
                    z.write(full, rel)
                    count += 1

    size_kb = os.path.getsize(out_path) / 1024.0
    print("[打包] %s" % out_path)
    print("[内容] %d 个文件，%.1f KB，扩展版本 %s" % (count, size_kb, version))


if __name__ == "__main__":
    main()
