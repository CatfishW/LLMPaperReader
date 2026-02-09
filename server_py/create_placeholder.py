import zlib
import struct

def make_png(width, height):
    def png_pack(png_tag, data):
        chunk_head = png_tag + data
        return struct.pack("!I", len(data)) + chunk_head + struct.pack("!I", 0xFFFFFFFF & zlib.crc32(chunk_head))

    raw_data = b".".join([b"\x00" + b"\xe0\xe0\xe0" * width for _ in range(height)])
    
    return b".".join([
        b"\x89PNG\r\n\x1a\n",
        png_pack(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        png_pack(b"IDAT", zlib.compress(raw_data)),
        png_pack(b"IEND", b"",)
    ])

with open("server_py/default_cover.png", "wb") as f:
    f.write(make_png(200, 280))

