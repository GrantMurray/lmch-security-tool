"""Encrypt the app's private files into assets/locked/bundle.bin.

Usage: python3 tools/lock_assets.py [--out PATH]
Prompts for the access code (or reads LMCH_CODE from the environment).

Both form templates (citation and shift report), the site list, fines list
and map images are packed into one file and encrypted with AES-256-GCM,
using a key derived from the access code with PBKDF2-SHA256. Only the encrypted bundle is published; the code itself is
never stored. The browser derives the same key from the code a person types
(src/vault.js); a wrong code fails GCM authentication.

Run it again after changing the code or any of the files below.
"""
import argparse
import base64
import getpass
import json
import os
import struct
import sys
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
ITERATIONS = 600_000
TYPES = {".pdf": "application/pdf", ".csv": "text/csv", ".jpg": "image/jpeg", ".png": "image/png"}


def private_files():
    files = [ROOT / "assets/forms/citation_fillable.pdf", ROOT / "assets/forms/shift_report_fillable.pdf",
             ROOT / "assets/data/numbers.csv", ROOT / "assets/data/fines.csv"]
    files += sorted((ROOT / "assets/maps/pages").glob("*.jpg"))
    missing = [str(f.relative_to(ROOT)) for f in files if not f.exists()]
    if missing:
        sys.exit(f"Missing files: {', '.join(missing)}")
    return files


def normalize(code):
    # must match src/vault.js: code.normalize("NFKC").trim()
    return unicodedata.normalize("NFKC", code).strip()


def read_code():
    code = os.environ.get("LMCH_CODE")
    if code is None:
        code = getpass.getpass("Access code: ")
        if getpass.getpass("Repeat code: ") != code:
            sys.exit("Codes don't match.")
    code = normalize(code)
    if len(code) < 8:
        print("Warning: codes shorter than 8 characters can be guessed offline "
              "by anyone with the bundle. A few random words is much safer.", file=sys.stderr)
    if not code:
        sys.exit("Empty code.")
    return code


def pack(files):
    entries, blobs, offset = [], [], 0
    for f in files:
        data = f.read_bytes()
        entries.append({"path": f.relative_to(ROOT).as_posix(), "type": TYPES[f.suffix.lower()],
                        "offset": offset, "length": len(data)})
        blobs.append(data)
        offset += len(data)
    manifest = json.dumps(entries).encode()
    return struct.pack(">I", len(manifest)) + manifest + b"".join(blobs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "assets/locked/bundle.bin"))
    out = Path(ap.parse_args().out)

    files = private_files()
    code = read_code()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=ITERATIONS).derive(code.encode())
    ciphertext = AESGCM(key).encrypt(iv, pack(files), None)  # includes the GCM tag

    header = json.dumps({
        "v": 1, "kdf": "PBKDF2-SHA256", "iterations": ITERATIONS,
        "salt": base64.b64encode(salt).decode(), "iv": base64.b64encode(iv).decode(),
    }).encode()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(struct.pack(">I", len(header)) + header + ciphertext)
    print(f"Encrypted {len(files)} files -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
