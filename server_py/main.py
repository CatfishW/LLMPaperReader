import os
import json
import shutil
import uuid
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio

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
            return [PaperIndexItem(**item) for item in data] if isinstance(data, list) else []
    except Exception as e:
        logger.error(f"Failed to read index: {e}")
        return []

def write_index(items: List[PaperIndexItem]):
    with open(INDEX_FILE, "w") as f:
        json.dump([item.dict() for item in items], f, indent=2)

def resolve_paper_dir(paper_id: str) -> str:
    # Basic validation to prevent traversal
    if not paper_id or ".." in paper_id or "/" in paper_id or "\\" in paper_id:
        raise HTTPException(status_code=400, detail="Invalid paper ID")
    path_ = os.path.join(PAPERS_DIR, paper_id)
    if not os.path.abspath(path_).startswith(os.path.abspath(PAPERS_DIR)):
         raise HTTPException(status_code=400, detail="Invalid path")
    return path_

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
    
    # Check if cover exists, if not serve default
    if not os.path.exists(cover_path):
        if os.path.exists(DEFAULT_COVER_PATH):
             return FileResponse(
                DEFAULT_COVER_PATH, 
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=31536000, immutable"}
            )
        else:
            # Create a 1x1 transparent png on the fly if missing
            return Response(
                content=b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff\x3f\x03\x00\x08\xfc\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82',
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=31536000, immutable"}
            )

    return FileResponse(
        cover_path, 
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"}
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
    cover: UploadFile = File(...),
    title: str = Form(...),
    tags: str = Form("")
):
    # Validation
    if pdf.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="PDF only")
    if cover.content_type != "image/png":
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
        # Check size (rough check as we stream)
        pdf_size = 0
        with open(pdf_dest, "wb") as f:
            while chunk := await pdf.read(1024 * 1024): # 1MB chunks
                pdf_size += len(chunk)
                if pdf_size > MAX_PDF_BYTES:
                    raise HTTPException(status_code=413, detail="PDF too large")
                f.write(chunk)
        
        async with aiofiles.open(cover_dest, 'wb') as out_file:
            content = await cover.read()
            await out_file.write(content)

        # Metadata
        tag_list = [t.strip() for t in tags.split(",") if t.strip()][:12]
        safe_filename = "".join(c for c in pdf.filename if c.isalnum() or c in "._-")[:120]
        final_title = title.strip() or os.path.splitext(safe_filename)[0]

        metadata = PaperMetadata(
            title=final_title,
            originalFilename=safe_filename,
            tags=tag_list,
            uploadedAt=datetime.utcnow().isoformat() + "Z",
            sizeBytes=pdf_size
        )

        with open(meta_dest, "w") as f:
            f.write(metadata.json(indent=2))

        # Update Index
        index = read_index()
        item = PaperIndexItem(id=paper_id, **metadata.dict())
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
    
    index = read_index()
    new_index = [i for i in index if i.id != paper_id]
    write_index(new_index)
    return Response(status_code=204)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
