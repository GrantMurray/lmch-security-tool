"""Render the block map pages listed in assets/data/numbers.csv to JPEGs.

Usage: python3 tools/render_maps.py
Reads the pdf_page and image columns and writes assets/maps/pages/<image>
from assets/maps/camp_map_2024.pdf. Requires pdftoppm (poppler-utils).
"""
import csv
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP_PDF = ROOT / "assets/maps/camp_map_2024.pdf"
CSV = ROOT / "assets/data/numbers.csv"
OUT_DIR = ROOT / "assets/maps/pages"
DPI = 200

pages = {}
with open(CSV, newline="") as f:
    for row in csv.DictReader(f):
        pages[row["image"]] = row["pdf_page"]

OUT_DIR.mkdir(parents=True, exist_ok=True)
for image, page in sorted(pages.items(), key=lambda kv: int(kv[1])):
    stem = OUT_DIR / Path(image).stem
    subprocess.run(
        ["pdftoppm", "-f", page, "-l", page, "-r", str(DPI), "-jpeg",
         "-jpegopt", "quality=78", "-singlefile", str(MAP_PDF), str(stem)],
        check=True,
    )
    print(f"page {page} -> {stem.with_suffix('.jpg').relative_to(ROOT)}")
