"""Generate 有影儀表板's three outlined SVG brand families and app assets.

Derived family typography follows tag.observe.tw/tools/brand-assets.py (MIT).
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


def legacy_accent(x, y, size, small=False):
    # Keep the upright ring and crossing arrow at badge size. Optical favicon
    # variants thicken the ring and simplify the arrow instead of scaling hairlines.
    body = legacy(None)
    if small:
        # 128 units yields a full 1px stroke in a 4px badge at 16px output.
        body = (f'<ellipse cx="230" cy="256" rx="128" ry="192" fill="none" stroke="{RED}" stroke-width="128"/>'
                f'<path fill="{RED}" d="M24 140 484 256 72 404 220 280Z"/>')
    return f'<g transform="translate({x-size/2:g} {y-size/2:g}) scale({size/512:g})">{body}</g>'


def legacy(ink):
    # Modern vector redraw of urtube.png: upright ring crossed by a curved play arrow.
    return (f'<ellipse cx="230" cy="256" rx="136" ry="224" fill="none" stroke="{RED}" stroke-width="36"/>'
            f'<path fill="{RED}" d="M29 110C203 117 391 174 484 257Q492 263 484 269C372 355 243 402 64 427Q54 428 60 419L205 324Q222 313 216 297C182 232 115 179 26 119Q19 112 29 110Z"/>')


def original(ink):
    # Original: a screen, playback triangle and three distinct observation columns.
    return (f'<rect x="48" y="76" width="416" height="328" rx="52" fill="none" stroke="{ink}" stroke-width="28"/>'
            f'<path d="M192 144 302 210 192 276Z" fill="{RED}"/>'
            f'<path d="M132 342v-32m124 32v-48m124 48V240" stroke="{RED}" stroke-width="28" stroke-linecap="round"/>'
            f'<path d="M184 454h144M256 408v46" stroke="{ink}" stroke-width="24" stroke-linecap="round"/>')


def family(ink):
    return run('有影', 61, 24, 198, ink) + run('儀表板', 45, 315, 145, ink) + legacy_accent(256, 267, 46)


marks = {'legacy': legacy, 'family': family, 'original': original}


def wordmark(kind, ink):
    if kind == 'family':
        return run('有影', 0, 0, 100, ink) + legacy_accent(217, 50, 28) + run('儀表板', 240, 0, 100, ink), 532
    return f'<g transform="translate(4 0) scale(.195)">{marks[kind](ink)}</g>' + run(NAME, 128, 0, 100, ink), 612


def svg(body, w=512, h=512, label=NAME, size=None):
    dimensions = f' width="{size or w}" height="{size or h}"'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"{dimensions} role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n'


def raster(source, target, width, height=None):
    subprocess.run(['rsvg-convert', '-w', str(width), '-h', str(height or width), '-o', str(target), str(source)], check=True)


for kind, draw in marks.items():
    folder = OUT / kind
    folder.mkdir(exist_ok=True)
    for mode, ink, paper in [('light', '#1c1c1f', '#fafafa'), ('dark', '#ededed', '#09090b')]:
        body = draw(ink)
        (folder / f'logo-{mode}.svg').write_text(svg(body))
        lock, width = wordmark(kind, ink)
        (folder / f'wordmark-{mode}.svg').write_text(svg(lock, width, 100))
        def make_icon(small=False, tiny=False):
            icon = f'<rect width="512" height="512" rx="96" fill="{paper}"/>'
            if kind == 'family':
                # At 16/32/48px the accent occupies 6/8/12px. The full-size
                # app icon keeps the original small badge's visual weight.
                icon += glyph('影', 48 if tiny else 64, 16 if tiny else (40 if small else 48), 320 if tiny else (344 if small else 370), ink)
                icon += legacy_accent(408 if tiny else (424 if small else 426), 408 if tiny else (434 if small else 454), 192 if tiny else (128 if small else 44), small)
            else:
                icon += f'<g transform="translate(24 24) scale(.90625)">{body}</g>'
            return icon
        icon = make_icon()
        (folder / f'icon-{mode}.svg').write_text(svg(make_icon(small=True, tiny=True)))
        safe = f'<rect width="512" height="512" fill="{paper}"/><g transform="translate(88 88) scale(.65625)">{body}</g>'
        (folder / f'maskable-{mode}.svg').write_text(svg(safe))
        for size in (192, 512):
            raster(folder / f'maskable-{mode}.svg', folder / f'maskable-{size}-{mode}.png', size)
        apple = icon.replace(' rx="96"', '')
        (folder / f'apple-180-{mode}.svg').write_text(svg(apple, size=180))
        raster(folder / f'apple-180-{mode}.svg', folder / f'apple-180-{mode}.png', 180)
        for size in (16, 32, 48, 180, 192, 512):
            asset = folder / f'icon-{size}-{mode}.svg'
            asset.write_text(svg(make_icon(small=size <= 48, tiny=size == 16), size=size))
            raster(asset, folder / f'icon-{size}-{mode}.png', size)
        # All share images include the complete outlined name, no platform font dependency.
        og = (f'<rect width="1200" height="630" fill="{paper}"/>'
              f'<g transform="translate(70 102) scale(.82)">{body}</g>'
              f'<path d="M532 180v275" stroke="{RED}" stroke-width="3"/>'
              + run(NAME, 586, 216, 100, ink)
              + run('同一件事，各台怎麼說', 590, 366, 38, ink))
        path = folder / f'og-{mode}.svg'
        path.write_text(svg(og, 1200, 630))
        raster(path, folder / f'og-{mode}.png', 1200, 630)

# Multi-image ICO includes native16/32/48px PNGs for each candidate/theme.
for kind in marks:
    for mode in ('light', 'dark'):
        images = [(size, (OUT / kind / f'icon-{size}-{mode}.png').read_bytes()) for size in (16, 32, 48)]
        offset, entries = 6 + 16 * len(images), []
        for size, data in images:
            entries.append(struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), offset))
            offset += len(data)
        ico = struct.pack('<HHH', 0, 1, len(images)) + b''.join(entries) + b''.join(data for _, data in images)
        (OUT / kind / f'favicon-{mode}.ico').write_bytes(ico)
(ROOT / 'web/public/favicon.ico').write_bytes((OUT / 'family/favicon-light.ico').read_bytes())
# Literal JSX paths (not a raw HTML sink); default combines the mother-site family with the legacy station mark.
components = []
for kind in marks:
    body, width = wordmark(kind, 'currentColor')
    body = body.replace('stroke-width=', 'strokeWidth=').replace('stroke-linecap=', 'strokeLinecap=')
    components.append(f"  {kind}: {{ width: {width}, body: <>{body}</> }},")
(ROOT / 'web/src/components/Wordmark.tsx').write_text(
    '// Generated by tools/brand-assets.py. Noto Serif CJK TC SemiBold outlines (SIL OFL).\n'
    'export type BrandVariant = "legacy" | "family" | "original";\n'
    'const marks = {\n' + '\n'.join(components) + '\n};\n'
    'export default function Wordmark({ className, height, variant = "family" }: { className?: string; height?: number; variant?: BrandVariant }) {\n'
    '  const mark = marks[variant];\n'
    '  return <svg viewBox={`0 0 ${mark.width} 100`} className={className} {...(height ? { width: Math.round(height * mark.width / 100), height } : {})} role="img" aria-label="有影儀表板"><title>有影儀表板</title>{mark.body}</svg>;\n}\n')
(OUT / 'generation.json').write_text(json.dumps({'font': font['name'].getDebugName(1), 'rasterizer': subprocess.check_output(['rsvg-convert','--version'], text=True).strip(), 'fontSha256': hashlib.sha256(FONT.read_bytes()).hexdigest(), 'variants': list(marks), 'default': 'family', 'accent': RED, 'glyphs': 'outlined; no external font needed'}, ensure_ascii=False, indent=2)+'\n')
print('Generated legacy, family, original SVG/PNG/ICO assets and Wordmark.tsx')
