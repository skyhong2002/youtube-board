"""Generate 有影儀表板's outlined SVG brand set and app assets.

Stacked typography follows tag.observe.tw/tools/brand-assets.py (MIT).
Needs fontTools, Noto Serif CJK TC SemiBold (SIL OFL), and rsvg-convert.
No fonts, remote services, or scripts are needed to render the generated assets.
Usage: python tools/brand-assets.py /path/NotoSerifCJK-SemiBold.ttc
"""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parents[1]
FONT = Path(sys.argv[1])
font = TTFont(FONT, fontNumber=3 if FONT.suffix == '.ttc' else -1)
if 'TC' not in (font['name'].getDebugName(1) or ''):
    raise ValueError('Use the Traditional Chinese font face')
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
RED, NAME = '#ff0000', '有影儀表板'
OUT = ROOT / 'web/public/brand'
OUT.mkdir(parents=True, exist_ok=True)


def glyph(ch, x, y, size, ink):
    pen = SVGPathPen(glyphs)
    glyphs[cmap[ord(ch)]].draw(pen)
    k = size / 1000
    return f'<path fill="{ink}" transform="translate({round(x, 2)} {round(y, 2)}) scale({k} {-k}) translate(0 -880)" d="{pen.getCommands()}"/>'


def run(text, x, y, size, ink):
    return ''.join(glyph(ch, x + i * size * .96, y, size, ink) for i, ch in enumerate(text))


# Modern vector redraw of youtube.board.tw's urtube.png: an upright ring crossed by a
# curved play arrow, in YouTube red on both themes. Ink spans x 19–492, y 14–498 of 512.
MARK = (f'<ellipse cx="230" cy="256" rx="136" ry="224" fill="none" stroke="{RED}" stroke-width="36"/>'
        f'<path fill="{RED}" d="M29 110C203 117 391 174 484 257Q492 263 484 269C372 355 243 402 64 427Q54 428 60 419L205 324Q222 313 216 297C182 232 115 179 26 119Q19 112 29 110Z"/>')


def mark(cx, cy, size):
    return f'<g transform="translate({cx - size / 2:g} {cy - size / 2:g}) scale({size / 512:g})">{MARK}</g>'


def logo(ink):
    # The square home logo: the mark large on top, the name on one line under it,
    # centred in 512 (ink y 48–465). The masthead cloud's LOGO_MASK follows its ink.
    return mark(256, 190, 300) + run(NAME, 22, 372, 96, ink)


def wordmark(ink):
    # Horizontal lockup: 有影, the mark (about 1.2× the text's ink height), 儀表板.
    return run('有影', 0, 10, 100, ink) + f'<g transform="translate(201.4 -1.4) scale(.24)">{MARK}</g>' + run('儀表板', 332, 10, 100, ink), 628, 120


def svg(body, w=512, h=512, label=NAME, size=None):
    dimensions = f' width="{size or w}" height="{size or h}"'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"{dimensions} role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n'


def raster(source, target, width, height=None):
    subprocess.run(['rsvg-convert', '-w', str(width), '-h', str(height or width), '-o', str(target), str(source)], check=True)


for old in OUT.glob('*/*'):
    if old.parent.name in ('family', 'legacy', 'original'):
        old.unlink()
for old in ('family', 'legacy', 'original'):
    if (OUT / old).is_dir():
        (OUT / old).rmdir()
(OUT / 'mark.svg').write_text(svg(MARK))
for mode, ink, paper in [('light', '#1c1c1f', '#fafafa'), ('dark', '#ededed', '#09090b')]:
    (OUT / f'logo-{mode}.svg').write_text(svg(logo(ink)))
    lock, width, height = wordmark(ink)
    (OUT / f'wordmark-{mode}.svg').write_text(svg(lock, width, height))
    # App icons carry only the red mark on the theme's paper.
    icon = f'<rect width="512" height="512" rx="96" fill="{paper}"/><g transform="translate(24 24) scale(.90625)">{MARK}</g>'
    (OUT / f'icon-{mode}.svg').write_text(svg(icon))
    safe = f'<rect width="512" height="512" fill="{paper}"/><g transform="translate(88 88) scale(.65625)">{MARK}</g>'
    (OUT / f'maskable-{mode}.svg').write_text(svg(safe))
    for size in (192, 512):
        raster(OUT / f'maskable-{mode}.svg', OUT / f'maskable-{size}-{mode}.png', size)
    apple = icon.replace(' rx="96"', '')
    (OUT / f'apple-180-{mode}.svg').write_text(svg(apple, size=180))
    raster(OUT / f'apple-180-{mode}.svg', OUT / f'apple-180-{mode}.png', 180)
    for size in (16, 32, 48, 180, 192, 512):
        asset = OUT / f'icon-{size}-{mode}.svg'
        asset.write_text(svg(icon, size=size))
        raster(asset, OUT / f'icon-{size}-{mode}.png', size)
    # All share images include the complete outlined name, no platform font dependency.
    og = (f'<rect width="1200" height="630" fill="{paper}"/>'
          f'<g transform="translate(70 102) scale(.82)">{MARK}</g>'
          f'<path d="M532 180v275" stroke="{RED}" stroke-width="3"/>'
          + run(NAME, 586, 216, 100, ink)
          + run('同一件事，各台怎麼說', 590, 366, 38, ink))
    path = OUT / f'og-{mode}.svg'
    path.write_text(svg(og, 1200, 630))
    raster(path, OUT / f'og-{mode}.png', 1200, 630)

# Multi-image ICO includes native 16/32/48px PNGs for each theme.
for mode in ('light', 'dark'):
    images = [(size, (OUT / f'icon-{size}-{mode}.png').read_bytes()) for size in (16, 32, 48)]
    offset, entries = 6 + 16 * len(images), []
    for size, data in images:
        entries.append(struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    ico = struct.pack('<HHH', 0, 1, len(images)) + b''.join(entries) + b''.join(data for _, data in images)
    (OUT / f'favicon-{mode}.ico').write_bytes(ico)
(ROOT / 'web/public/favicon.ico').write_bytes((OUT / 'favicon-light.ico').read_bytes())
# Literal JSX paths (not a raw HTML sink) for the header and footer lockup.
body, width, height = wordmark('currentColor')
body = body.replace('stroke-width=', 'strokeWidth=')
(ROOT / 'web/src/components/Wordmark.tsx').write_text(
    '// Generated by tools/brand-assets.py. Noto Serif CJK TC SemiBold outlines (SIL OFL).\n'
    f'const width = {width}, height = {height};\n'
    f'const body = <>{body}</>;\n'
    'export default function Wordmark({ className }: { className?: string }) {\n'
    '  return <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label="有影儀表板"><title>有影儀表板</title>{body}</svg>;\n}\n')
(OUT / 'generation.json').write_text(json.dumps({'font': font['name'].getDebugName(1), 'rasterizer': subprocess.check_output(['rsvg-convert','--version'], text=True).strip(), 'fontSha256': hashlib.sha256(FONT.read_bytes()).hexdigest(), 'accent': RED, 'glyphs': 'outlined; no external font needed'}, ensure_ascii=False, indent=2)+'\n')
print('Generated logo, wordmark, mark, icon SVG/PNG/ICO assets and Wordmark.tsx')
