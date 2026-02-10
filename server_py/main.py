import os
import json
import shutil
import uuid
import logging
import subprocess
import tempfile
import zlib
from typing import List
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
import aiofiles

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("llmpaperreader")

app = FastAPI()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT_DIR, "data")
PAPERS_DIR = os.path.join(DATA_DIR, "papers")
TMP_DIR = os.path.join(DATA_DIR, "tmp")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")
DEFAULT_COVER_PATH = os.path.join(os.path.dirname(__file__), "default_cover.png")
MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_COVER_BYTES = 10 * 1024 * 1024

PNG_SIG = b"\x89PNG\r\n\x1a\n"

# Ensure directories exist
os.makedirs(PAPERS_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)
if not os.path.exists(INDEX_FILE):
    with open(INDEX_FILE, "w") as f:
        json.dump([], f, indent=2)

class PaperMetadata(BaseModel):
    title: str
    originalFilename: str
    tags: List[str]
    uploadedAt: str
    sizeBytes: int

class PaperIndexItem(PaperMetadata):
    id: str

def read_index() -> List[PaperIndexItem]:
    try:
        if not os.path.exists(INDEX_FILE):
            return []
        with open(INDEX_FILE, "r") as f:
            data = json.load(f)
            if not isinstance(data, list):
                return []
            items: List[PaperIndexItem] = []
            for raw in data:
                if not isinstance(raw, dict):
                    continue
                try:
                    items.append(PaperIndexItem(**raw))
                except Exception:
                    # Skip malformed entries instead of failing the whole index.
                    continue
            return items
    except Exception as e:
        logger.error(f"Failed to read index: {e}")
        return []

def write_index(items: List[PaperIndexItem]):
    tmp_path = f"{INDEX_FILE}.tmp"
    with open(tmp_path, "w") as f:
        json.dump([item.model_dump() for item in items], f, indent=2)
    os.replace(tmp_path, INDEX_FILE)

def resolve_paper_dir(paper_id: str) -> str:
    # Basic validation to prevent traversal
    if not paper_id or ".." in paper_id or "/" in paper_id or "\\" in paper_id:
        raise HTTPException(status_code=400, detail="Invalid paper ID")
    path_ = os.path.join(PAPERS_DIR, paper_id)
    if not os.path.abspath(path_).startswith(os.path.abspath(PAPERS_DIR)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return path_

def now_iso_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def _png_dimensions_from_header(buf: bytes) -> tuple[int, int] | None:
    """
    Parse PNG width/height from initial bytes (needs at least 29 bytes).
    Returns None if it doesn't look like a PNG with IHDR at the start.
    """
    if len(buf) < 29:
        return None
    if buf[:8] != PNG_SIG:
        return None
    # 8-byte signature then first chunk: length(4), type(4), data...
    chunk_type = buf[12:16]
    if chunk_type != b"IHDR":
        return None
    width = int.from_bytes(buf[16:20], "big", signed=False)
    height = int.from_bytes(buf[20:24], "big", signed=False)
    if width <= 0 or height <= 0:
        return None
    return width, height

def _build_png_rgba(width: int, height: int, pixel_fn) -> bytes:
    """
    Build a simple RGBA PNG using only stdlib (zlib + crc32).
    pixel_fn(x, y) -> (r,g,b,a) 0-255
    """
    def chunk(typ: bytes, data: bytes) -> bytes:
        return (
            len(data).to_bytes(4, "big")
            + typ
            + data
            + (zlib.crc32(typ + data) & 0xFFFFFFFF).to_bytes(4, "big")
        )

    # Raw image data: filter byte + RGBA scanline per row.
    rows = []
    for y in range(height):
        row = bytearray()
        row.append(0)  # filter type 0
        for x in range(width):
            r, g, b, a = pixel_fn(x, y)
            row.extend((r & 255, g & 255, b & 255, a & 255))
        rows.append(bytes(row))
    raw = b"".join(rows)
    compressed = zlib.compress(raw, level=9)

    ihdr = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + bytes([8, 6, 0, 0, 0])  # 8-bit, RGBA
    )
    return PNG_SIG + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

def placeholder_cover_png(width: int = 360, height: int = 480) -> bytes:
    # Light background with a subtle border and top band.
    bg = (245, 246, 248, 255)
    border = (210, 214, 220, 255)
    band = (225, 228, 234, 255)

    def px(x: int, y: int):
        if x == 0 or y == 0 or x == width - 1 or y == height - 1:
            return border
        if y < 48:
            return band
        return bg

    return _build_png_rgba(width, height, px)

_DEFAULT_COVER_BYTES: bytes | None = None

def default_cover_bytes() -> bytes:
    """
    Prefer a bundled default cover image if it exists and isn't a 1x1 placeholder.
    Never writes to disk; always falls back to a generated placeholder.
    """
    global _DEFAULT_COVER_BYTES
    if _DEFAULT_COVER_BYTES is not None:
        return _DEFAULT_COVER_BYTES
    try:
        if os.path.exists(DEFAULT_COVER_PATH):
            with open(DEFAULT_COVER_PATH, "rb") as f:
                data = f.read()
            dims = _png_dimensions_from_header(data[:64])
            if dims and dims != (1, 1) and len(data) > 1024:
                _DEFAULT_COVER_BYTES = data
                return data
    except Exception:
        pass
    data = placeholder_cover_png()
    _DEFAULT_COVER_BYTES = data
    return data

def is_placeholder_png_file(path_: str) -> bool:
    try:
        with open(path_, "rb") as f:
            head = f.read(64)
        dims = _png_dimensions_from_header(head)
        return dims == (1, 1)
    except Exception:
        return False

def _which(cmd: str) -> str | None:
    return shutil.which(cmd)

def try_generate_cover_from_pdf(pdf_path: str, cover_path: str) -> bool:
    """
    Best-effort PDF -> PNG render using external tools if available.
    No hard dependency; returns False if nothing worked.
    """
    try:
        if not os.path.exists(pdf_path):
            return False
        os.makedirs(os.path.dirname(cover_path), exist_ok=True)

        with tempfile.TemporaryDirectory(prefix="llmpr-cover-") as tmpdir:
            out_tmp = os.path.join(tmpdir, "cover.png")

            pdftoppm = _which("pdftoppm")
            if pdftoppm:
                # Creates <prefix>.png
                prefix = os.path.join(tmpdir, "cover")
                cmd = [pdftoppm, "-f", "1", "-l", "1", "-png", "-singlefile", "-scale-to-x", "640", pdf_path, prefix]
                try:
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                    candidate = f"{prefix}.png"
                    if os.path.exists(candidate):
                        shutil.move(candidate, out_tmp)
                except Exception:
                    pass

            if not os.path.exists(out_tmp):
                mutool = _which("mutool")
                if mutool:
                    # mutool draw -o out.png -F png -r 144 file.pdf 1
                    cmd = [mutool, "draw", "-o", out_tmp, "-F", "png", "-r", "144", pdf_path, "1"]
                    try:
                        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                    except Exception:
                        pass

            if not os.path.exists(out_tmp):
                gs = _which("gs")
                if gs:
                    cmd = [
                        gs,
                        "-dSAFER",
                        "-dBATCH",
                        "-dNOPAUSE",
                        "-dFirstPage=1",
                        "-dLastPage=1",
                        "-sDEVICE=pngalpha",
                        "-r144",
                        f"-sOutputFile={out_tmp}",
                        pdf_path,
                    ]
                    try:
                        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                    except Exception:
                        pass

            if not os.path.exists(out_tmp):
                return False
            if os.path.getsize(out_tmp) < 1024:
                return False
            with open(out_tmp, "rb") as f:
                head = f.read(32)
            if not head.startswith(PNG_SIG):
                return False
            tmp_path = f"{cover_path}.tmp"
            shutil.copyfile(out_tmp, tmp_path)
            os.replace(tmp_path, cover_path)
            return True
    except Exception as e:
        logger.info(f"Cover generation failed: {e}")
        return False

index_lock = asyncio.Lock()
cover_gen_locks: dict[str, asyncio.Lock] = {}
cover_gen_locks_lock = asyncio.Lock()
cover_gen_failed: set[str] = set()

async def get_cover_lock(paper_id: str) -> asyncio.Lock:
    async with cover_gen_locks_lock:
        lock = cover_gen_locks.get(paper_id)
        if lock is None:
            lock = asyncio.Lock()
            cover_gen_locks[paper_id] = lock
        return lock

@app.get("/api/health")
async def health_check():
    return {"ok": True}

@app.get("/api/papers", response_model=List[PaperIndexItem])
async def list_papers():
    return read_index()

@app.get("/api/papers/{paper_id}")
async def get_paper(paper_id: str):
    paper_dir = resolve_paper_dir(paper_id)
    meta_path = os.path.join(paper_dir, "metadata.json")
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        with open(meta_path, "r") as f:
            metadata = json.load(f)
        return {"id": paper_id, **metadata}
    except Exception:
        raise HTTPException(status_code=500, detail="Error reading metadata")

@app.get("/api/papers/{paper_id}/cover")
async def get_cover(paper_id: str):
    paper_dir = resolve_paper_dir(paper_id)
    cover_path = os.path.join(paper_dir, "cover.png")
    pdf_path = os.path.join(paper_dir, "paper.pdf")
    
    # Covers may be regenerated (or replaced) over time; avoid long-lived immutable caching.
    headers = {"Cache-Control": "public, max-age=0, must-revalidate"}

    # If cover missing or placeholder (e.g. seed import), try to render from PDF (best-effort).
    # Never writes a placeholder to disk on read; if rendering isn't possible, we serve a
    # non-trivial placeholder response so the UI doesn't look broken.
    if not os.path.exists(cover_path) or is_placeholder_png_file(cover_path):
        lock = await get_cover_lock(paper_id)
        async with lock:
            if paper_id not in cover_gen_failed and (not os.path.exists(cover_path) or is_placeholder_png_file(cover_path)):
                ok = await asyncio.to_thread(try_generate_cover_from_pdf, pdf_path, cover_path)
                if not ok:
                    cover_gen_failed.add(paper_id)

    if not os.path.exists(cover_path) or is_placeholder_png_file(cover_path):
        return Response(content=default_cover_bytes(), media_type="image/png", headers=headers)

    return FileResponse(
        cover_path, 
        media_type="image/png",
        headers=headers
    )

@app.get("/api/papers/{paper_id}/file")
async def get_file(paper_id: str, download: str = "0"):
    paper_dir = resolve_paper_dir(paper_id)
    pdf_path = os.path.join(paper_dir, "paper.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Not found")
    
    index = read_index()
    item = next((i for i in index if i.id == paper_id), None)
    filename = item.originalFilename if item else "paper.pdf"
    
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    
    if download == "1":
        return FileResponse(
            pdf_path, 
            filename=filename, 
            media_type="application/pdf",
            headers=headers
        )
    return FileResponse(
        pdf_path, 
        media_type="application/pdf",
        headers=headers
    )

@app.post("/api/papers", status_code=201)
async def upload_paper(
    pdf: UploadFile = File(...),
    cover: UploadFile | None = File(default=None),
    title: str = Form(...),
    tags: str = Form("")
):
    # Validation
    if pdf.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="PDF only")
    if cover and cover.content_type not in ("image/png", "image/x-png", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Cover must be PNG")

    # Generate ID and paths
    paper_id = str(uuid.uuid4())
    paper_dir = os.path.join(PAPERS_DIR, paper_id)
    os.makedirs(paper_dir, exist_ok=True)
    
    pdf_dest = os.path.join(paper_dir, "paper.pdf")
    cover_dest = os.path.join(paper_dir, "cover.png")
    meta_dest = os.path.join(paper_dir, "metadata.json")

    # Save files
    try:
        # Stream PDF to disk with signature validation.
        pdf_size = 0
        first = await pdf.read(4)
        if first != b"%PDF":
            raise HTTPException(status_code=400, detail="Invalid PDF")
        async with aiofiles.open(pdf_dest, "wb") as out_pdf:
            await out_pdf.write(first)
            pdf_size += len(first)
            while True:
                chunk = await pdf.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                pdf_size += len(chunk)
                if pdf_size > MAX_PDF_BYTES:
                    raise HTTPException(status_code=413, detail="PDF too large")
                await out_pdf.write(chunk)

        cover_wrote = False
        cover_is_placeholder = True
        if cover is not None:
            # Stream cover to disk, validate it looks like a PNG, and detect 1x1 placeholders.
            cover_size = 0
            head = await cover.read(32)
            cover_size += len(head)
            dims = _png_dimensions_from_header(head)
            if not head.startswith(PNG_SIG) or dims is None:
                # Allow clients that send octet-stream; validate by signature/structure.
                raise HTTPException(status_code=400, detail="Cover must be PNG")
            cover_is_placeholder = dims == (1, 1)

            async with aiofiles.open(cover_dest, "wb") as out_cover:
                await out_cover.write(head)
                while True:
                    chunk = await cover.read(1024 * 256)
                    if not chunk:
                        break
                    cover_size += len(chunk)
                    if cover_size > MAX_COVER_BYTES:
                        raise HTTPException(status_code=413, detail="Cover too large")
                    await out_cover.write(chunk)
            cover_wrote = True

        if not cover_wrote or cover_is_placeholder:
            # Try to generate cover from the PDF via external tools; otherwise fall back to placeholder.
            ok = await asyncio.to_thread(try_generate_cover_from_pdf, pdf_dest, cover_dest)
            if not ok:
                async with aiofiles.open(cover_dest, "wb") as out_cover:
                    await out_cover.write(default_cover_bytes())

        # Metadata
        tag_list = [t.strip() for t in tags.split(",") if t.strip()][:12]
        raw_name = pdf.filename or "paper.pdf"
        safe_filename = "".join(c for c in raw_name if c.isalnum() or c in "._-")[:120]
        final_title = title.strip() or os.path.splitext(safe_filename)[0]

        metadata = PaperMetadata(
            title=final_title,
            originalFilename=safe_filename,
            tags=tag_list,
            uploadedAt=now_iso_z(),
            sizeBytes=pdf_size
        )

        with open(meta_dest, "w") as f:
            f.write(metadata.model_dump_json(indent=2))

        # Update Index
        async with index_lock:
            index = read_index()
            item = PaperIndexItem(id=paper_id, **metadata.model_dump())
            index.insert(0, item)
            write_index(index)
        
        return item

    except HTTPException as e:
        # Cleanup
        shutil.rmtree(paper_dir, ignore_errors=True)
        raise e
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        shutil.rmtree(paper_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Upload failed")

@app.delete("/api/papers/{paper_id}", status_code=204)
async def delete_paper(paper_id: str):
    paper_dir = resolve_paper_dir(paper_id)
    if os.path.exists(paper_dir):
        shutil.rmtree(paper_dir)
    
    async with index_lock:
        index = read_index()
        new_index = [i for i in index if i.id != paper_id]
        write_index(new_index)
    return Response(status_code=204)

@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Server error"})

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
