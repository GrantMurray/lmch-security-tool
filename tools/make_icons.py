"""Generate app icons (home screen / install) from assets/icons/icon.svg.

Usage: python3 tools/make_icons.py
Needs ImageMagick (`magick`) with librsvg.
Writes assets/icons/: icon-192.png, icon-512.png, icon-maskable-512.png,
apple-touch-icon.png (180px).
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/icons"
SVG = (OUT / "icon.svg").read_text()


def icon(size, name, scale=1.0):
    """Render the SVG at size px, with the artwork scaled about the centre."""
    svg = SVG
    if scale != 1.0:
        # The background extends past the viewBox, so shrinking leaves no gaps.
        offset = 256 * (1 - scale)
        head, body = svg.split(">", 1)
        body, tail = body.rsplit("</svg>", 1)
        svg = f'{head}><g transform="translate({offset} {offset}) scale({scale})">{body}</g></svg>{tail}'
    subprocess.run(
        ["magick", "-background", "none", "-density", str(96 * size / 512),
         "svg:-", "-resize", f"{size}x{size}!", "-strip", str(OUT / name)],
        input=svg.encode(), check=True,
    )


icon(192, "icon-192.png")
icon(512, "icon-512.png")
icon(512, "icon-maskable-512.png", scale=0.68)  # Android masks to ~80% circle
icon(180, "apple-touch-icon.png")
print("wrote", sorted(p.name for p in OUT.glob("*.png")))
