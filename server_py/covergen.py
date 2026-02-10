#!/usr/bin/env python3
"""
Render the first page of a PDF to a PNG cover image.

Usage:
  covergen.py <pdf_path> <out_png_path> [--max-width 640]
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_path")
    ap.add_argument("out_png_path")
    ap.add_argument("--max-width", type=int, default=640)
    args = ap.parse_args()

    pdf_path = os.path.abspath(args.pdf_path)
    out_png_path = os.path.abspath(args.out_png_path)
    max_width = int(args.max_width)
    if max_width < 64:
        max_width = 64

    if not os.path.exists(pdf_path):
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 2

    try:
        import fitz  # PyMuPDF
    except Exception as e:
        print(f"Missing dependency PyMuPDF (import fitz failed): {e}", file=sys.stderr)
        return 3

    try:
        doc = fitz.open(pdf_path)
        if doc.page_count < 1:
            print("PDF has no pages", file=sys.stderr)
            return 4
        page = doc.load_page(0)
        rect = page.rect
        if rect.width <= 0:
            scale = 2.0
        else:
            scale = max_width / float(rect.width)
            # keep scale in a sane range
            scale = max(0.5, min(4.0, scale))

        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=True)

        os.makedirs(os.path.dirname(out_png_path), exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(prefix="cover-", suffix=".png", dir=os.path.dirname(out_png_path))
        os.close(fd)
        try:
            pix.save(tmp_path)
            os.replace(tmp_path, out_png_path)
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except Exception:
                pass
        return 0
    except Exception as e:
        print(f"Render failed: {e}", file=sys.stderr)
        return 5
    finally:
        try:
            doc.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

