"""Blood Moon Familiar sprite, redrawn by hand from the user's in-game screenshot (2026-11-06).

Usage: python -I tools/sprites/blood_moon_familiar.py <out.png> [scale]
No background, no outline, like the wiki's item sprites (a shade colour instead of a border).
"""
import struct, sys, zlib

PALETTE = {
    '.': None,
    'G': (152, 152, 158),  # wing bones, wing tips, feet
    'g': (118, 117, 122),  # head
    'R': (198, 53, 48),    # wings
    'r': (150, 38, 40),    # wing shade
    'B': (95, 24, 22),     # body
    'E': (227, 13, 15),    # eyes
    'W': (255, 252, 248),  # fangs
}

ROWS = [
    'G.............G',
    '.GG.........GG.',
    '.RRGG.....GGRR.',
    '.RRRG.g.g.GRRR.',
    '..RRGgg.ggGRR..',
    '..RRgggggggRR..',
    '..RRggEgEggRR..',
    '.RRRggWgWggRRR.',
    '.RRRRrgggrRRRR.',
    '.rRRRRBBBRRRRr.',
    '..rr.RBBBR.rr..',
    '.....rBBBr.....',
    '......G.G......',
    '.....G...G.....',
]


def write_png(path: str, rows: list[str], scale: int = 1) -> None:
    w, h = len(rows[0]) * scale, len(rows) * scale
    raw = b''
    for row in rows:
        line = b''.join((bytes(PALETTE[c]) + b'\xff' if PALETTE[c] else b'\0\0\0\0') * scale for c in row)
        raw += (b'\0' + line) * scale
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    assert all(len(r) == len(ROWS[0]) for r in ROWS)
    write_png(sys.argv[1], ROWS, int(sys.argv[2]) if len(sys.argv) > 2 else 1)
