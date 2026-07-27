#!/usr/bin/env python3
"""Slice the uploaded art into game-ready assets.

- removes flat backgrounds by flood-filling from the image border
- slices regular sheets by grid, irregular sheets by connected components
- extracts frames from the animated backgrounds
- writes everything to assets/ plus a manifest the game loader reads
"""
import json
import os
import sys
from collections import deque

from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
os.makedirs(OUT, exist_ok=True)
manifest = {}


def key_bg(im, tol=34, extra_seeds=()):
    """Flood-fill transparent from the border (keeps enclosed grays intact)."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    # sample border color from the corners
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    br = sum(c[0] for c in corners) / 4
    bg = sum(c[1] for c in corners) / 4
    bb = sum(c[2] for c in corners) / 4
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    q.extend(extra_seeds)
    t2 = tol * tol * 3
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        r, g, b, a = px[x, y]
        d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2
        if d > t2:
            continue
        seen[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        q.append((x + 1, y)); q.append((x - 1, y))
        q.append((x, y + 1)); q.append((x, y - 1))
    return im


def despeckle(im, min_alpha_run=3):
    """Drop lonely opaque specks left by jpeg noise."""
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                continue
            n = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and px[xx, yy][3] > 0:
                    n += 1
            if n == 0:
                px[x, y] = (0, 0, 0, 0)
    return im


def global_key(im, tol=34):
    """Remove EVERY pixel near the sheet background, not just the border-connected
    ones — sprite sheets trap background inside enclosed shapes (between beams,
    under a roof) that a flood fill can never reach."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    br = sum(c[0] for c in corners) / 4
    bg = sum(c[1] for c in corners) / 4
    bb = sum(c[2] for c in corners) / 4
    t2 = tol * tol * 3
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 < t2:
                px[x, y] = (0, 0, 0, 0)
    return im


def defringe(im, bg=None, tol=70, passes=2):
    """Flood fill leaves a rim of half-background pixels; drop any edge pixel
    that is still close to the background colour."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    if bg is None:
        # estimate from whatever transparent neighbours remain
        bg = (139, 146, 168)
    t2 = tol * tol * 3
    for _ in range(passes):
        doomed = []
        for y in range(h):
            for x in range(w):
                if px[x, y][3] == 0:
                    continue
                edge = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + dx, y + dy
                    if xx < 0 or yy < 0 or xx >= w or yy >= h or px[xx, yy][3] == 0:
                        edge = True
                        break
                if not edge:
                    continue
                r, g, b, a = px[x, y]
                d = (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2
                if d < t2:
                    doomed.append((x, y))
        if not doomed:
            break
        for x, y in doomed:
            px[x, y] = (0, 0, 0, 0)
    return im


def biggest_blob(im):
    """Keep only the largest connected shape — kills bleed from the neighbouring
    cell when a sprite sheet's grid does not divide evenly."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    best, bestn = None, 0
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or px[sx, sy][3] == 0:
                continue
            q = deque([(sx, sy)])
            seen[sy * w + sx] = 1
            cells = []
            while q:
                x, y = q.popleft()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and not seen[yy * w + xx] and px[xx, yy][3] > 0:
                        seen[yy * w + xx] = 1
                        q.append((xx, yy))
            if len(cells) > bestn:
                bestn, best = len(cells), cells
    if not best:
        return im
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and (x, y) not in keep:
                px[x, y] = (0, 0, 0, 0)
    return im


def punch(im, sat=1.42, mul=0.985):
    """Bake richer colour and a touch of shade into an asset, so the game can
    look saturated and moody without a per-frame filter pass."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            r = int(max(0, min(255, (lum + (r - lum) * sat) * mul)))
            g = int(max(0, min(255, (lum + (g - lum) * sat) * mul)))
            b = int(max(0, min(255, (lum + (b - lum) * sat) * mul)))
            px[x, y] = (r, g, b, a)
    return im


def trim(im):
    box = im.getbbox()
    return im.crop(box) if box else im


def save(name, im):
    im = punch(im)
    path = os.path.join(OUT, name + '.png')
    im.save(path, optimize=True)
    manifest[name] = {'w': im.size[0], 'h': im.size[1]}
    print(f'  {name}: {im.size[0]}x{im.size[1]} ({os.path.getsize(path)//1024}KB)')


def grid_slice(src, cols, rows, names, tol=34, target_h=None, target_w=None,
               solo=False, defr=False, inset=0):
    im = key_bg(Image.open(os.path.join(ROOT, src)), tol)
    if defr:
        im = defringe(im)
    w, h = im.size
    cw, ch = w / cols, h / rows
    i = 0
    for r in range(rows):
        for c in range(cols):
            if i >= len(names):
                break
            box = (int(c * cw) + inset, int(r * ch) + inset,
                   int((c + 1) * cw) - inset, int((r + 1) * ch) - inset)
            cell = im.crop(box)
            if solo:
                cell = biggest_blob(cell)
            cell = trim(cell)
            if names[i]:
                cell = despeckle(cell)
                if target_h and cell.size[1] > target_h:
                    s = target_h / cell.size[1]
                    cell = cell.resize((max(1, round(cell.size[0] * s)), target_h), Image.NEAREST)
                if target_w and cell.size[0] > target_w:
                    s = target_w / cell.size[0]
                    cell = cell.resize((target_w, max(1, round(cell.size[1] * s))), Image.NEAREST)
                save(names[i], cell)
            i += 1


def components(im, min_area=900, merge_pad=6):
    """Connected components over alpha with generous merge padding."""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    boxes = []
    for sy in range(0, h, 4):
        for sx in range(0, w, 4):
            if seen[sy * w + sx] or px[sx, sy][3] == 0:
                continue
            q = deque([(sx, sy)])
            seen[sy * w + sx] = 1
            x0, y0, x1, y1 = sx, sy, sx, sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)
                for dx in (-2, 0, 2):
                    for dy in (-2, 0, 2):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < w and 0 <= yy < h and not seen[yy * w + xx] and px[xx, yy][3] > 0:
                            seen[yy * w + xx] = 1
                            q.append((xx, yy))
            if n * 4 >= min_area:
                boxes.append([x0, y0, x1 + 1, y1 + 1])
    # merge overlapping/nearby boxes
    merged = True
    while merged:
        merged = False
        out = []
        while boxes:
            b = boxes.pop()
            for o in out:
                if not (b[2] + merge_pad < o[0] or o[2] + merge_pad < b[0]
                        or b[3] + merge_pad < o[1] or o[3] + merge_pad < b[1]):
                    o[0] = min(o[0], b[0]); o[1] = min(o[1], b[1])
                    o[2] = max(o[2], b[2]); o[3] = max(o[3], b[3])
                    merged = True
                    break
            else:
                out.append(b)
        boxes = out
    boxes.sort(key=lambda b: (round(b[1] / 120), b[0]))
    return boxes


def gif_frames(src, name, count, box=None, target=None, step_offset=0):
    im = Image.open(os.path.join(ROOT, src))
    n = im.n_frames
    idxs = [min(n - 1, step_offset + round(i * n / count)) for i in range(count)]
    for j, idx in enumerate(idxs):
        im.seek(idx)
        fr = im.convert('RGB')
        if box:
            fr = fr.crop(box)
        if target:
            fr = fr.resize(target, Image.LANCZOS)
        fr = punch(fr.convert('RGBA'), 1.20, 0.98).convert('RGB')
        path = os.path.join(OUT, f'{name}{j}.jpg')
        fr.save(path, quality=82, optimize=True)
        manifest[f'{name}{j}'] = {'w': fr.size[0], 'h': fr.size[1], 'ext': 'jpg'}
    total = sum(os.path.getsize(os.path.join(OUT, f'{name}{j}.jpg')) for j in range(count)) // 1024
    print(f'  {name}0..{count-1}: {total}KB total')


print('shell sheets (crusted / clean / open)...')
SHELLS = ['pearl', 'clam', 'mussel', 'scallop', 'cockle', 'conch', 'whelk', 'abalone']
grid_slice('1018D17D-8991-4669-896C-C8AC4D96652F.png', 4, 2, [f'crust_{s}' for s in SHELLS], target_h=132)
grid_slice('E09CC168-D3F6-41EC-8AFB-EA7DCD7BE151.png', 4, 2, [f'shell_{s}' for s in SHELLS], target_h=132)
grid_slice('BFCC98C5-7462-41A9-903F-F14436B5E6C7.png', 4, 2, [f'open_{s}' for s in SHELLS], target_h=168)

print('critters...')
grid_slice('D4666433-3C9F-4DFB-990E-05C6F744C3B7.png', 4, 3,
           ['jelly_0', 'jelly_1', 'jelly_2', 'jelly_3',
            'eel_0', 'eel_1', 'eel_2', 'eel_3',
            'urchin_0', 'urchin_1', 'urchin_2', 'urchin_3'], target_h=110)

print('diver otter sheet (idle / walk / run / swim / dive / hold)...')
grid_slice('A33C234D-8DAF-45A2-8B3B-C6C04C0F366F.png', 4, 4,
           ['o4_0', 'o4_1', 'o4_2', 'o4_3',
            'o4_4', 'o4_5', 'o4_6', 'o4_7',
            'o4_run', 'o4_run2', 'o4_swim', 'o4_dive',
            'o4_swim2', 'o4_grab', 'o4_basket', 'o4_hold'], tol=24, target_h=112, solo=True, inset=4)

print('drone poses...')
grid_slice('94E66AAE-4813'[:0] + '94E66AAE-6E7E-4813-A583-EED25CC7193B.png', 4, 2,
           ['drone_fly', 'drone_side', 'drone_claw', 'drone_hang',
            'drone_lift', 'drone_lift2', 'drone_go', 'drone_go2'], target_h=110)

print('gear icons...')
grid_slice('47D385F6-2F9E-42C5-A2B5-0A1AFF061733.png', 4, 3,
           ['g_helmet', 'g_mask', 'g_tank', 'g_fins',
            'g_suit', 'g_belt', 'g_knife', 'g_plier',
            'g_scraper', 'g_crowbar', 'g_torch', 'g_netbag'], target_h=72)

print('pole...')
pole = trim(key_bg(Image.open(os.path.join(ROOT, '59157A61-FA0E-450E-A739-A006F2DCE590.png'))))
pole = pole.resize((round(pole.size[0] * 0.72), round(pole.size[1] * 0.72)), Image.LANCZOS)
save('pole', pole)

print('house exterior (full + cropped top: hut and platform only)...')
hx = despeckle(trim(key_bg(Image.open(os.path.join(ROOT, '840E2071-1BC2-437D-BF2C-FE6478FF1DA3.jpeg')), tol=46)))
save('house_ext', hx)
# the stilts are the pier's job — keep only the hut and the boards it stands on,
# then upscale so the detail holds at a bigger on-screen size
top = trim(hx.crop((0, 0, hx.size[0], round(hx.size[1] * 0.60))))
top = top.resize((round(top.size[0] * 2.2), round(top.size[1] * 2.2)), Image.LANCZOS)
save('house_top', top)

print('houses (already background-free) + workbench prop...')
hut = trim(Image.open(os.path.join(ROOT, '044A2D24-7F4F-4661-A7BB-C5E89EC3CD66-removebg-preview.png')).convert('RGBA'))
save('hut_full', hut)
# the room itself: crop away the stilts, keep the porch floor and everything above
room = trim(hut.crop((0, 0, hut.size[0], round(hut.size[1] * 0.70))))
room = room.resize((round(room.size[0] * 3.2), round(room.size[1] * 3.2)), Image.LANCZOS)
save('hut_room', room)

hx2 = trim(Image.open(os.path.join(ROOT, '840E2071-1BC2-437D-BF2C-FE6478FF1DA3-removebg-preview.png')).convert('RGBA'))
house_clean = hx2.resize((round(hx2.size[0] * 1.8), round(hx2.size[1] * 1.8)), Image.LANCZOS)
save('house_clean', house_clean)
# Just the building: everything above the sprite's own deck (its top row is 277
# of 598, so cut at 274 to clear the boards) and right of its stair rail (x 264).
# The pier is then the only deck in the scene, so the two can't disagree about
# plank style, post spacing or deck thickness.
save('house_body', trim(house_clean.crop((264, 0, house_clean.size[0], 274))))

wb = defringe(trim(global_key(Image.open(os.path.join(ROOT, 'IMG_4468.jpeg')), 48)), tol=88, passes=3)
save('workbench', wb)

print('house interior...')
hi = trim(key_bg(Image.open(os.path.join(ROOT, '2DD3E769-96DE-4F19-9812-7A79465BF57B.png')), tol=30))
hi = hi.resize((1440, round(hi.size[1] * 1440 / hi.size[0])), Image.LANCZOS)
save('house_int', hi)

print('dock modules (components)...')
dk = defringe(global_key(Image.open(os.path.join(ROOT, '5EE6640E-E83B-4DA3-BFAD-E80A0066A61C.png')), 40), (162, 168, 182))
for i, b in enumerate(components(dk)):
    save(f'dock_{i}', trim(dk.crop(tuple(b))))

print('furniture (components)...')
# This sheet's darkest sprite colour (the bed's blue blanket) sits only ~105 from
# the background, so global_key punched holes in it and the old defringe tol of 70
# (= 121 in RGB distance) ate its every edge. The cells are all border-reachable,
# so a plain flood fill plus a tight defringe is both safer and cleaner.
FURN_BG = (156, 162, 180)
fu = defringe(key_bg(Image.open(os.path.join(ROOT, '175C57F7-66B8-4C75-A0DB-5DC747AEBA78.png')), tol=46),
              FURN_BG, tol=46, passes=1)
for i, b in enumerate(components(fu, min_area=500)):
    save(f'furn_{i}', trim(fu.crop(tuple(b))))

print('animated ocean (pixel-art, upscaled with NEAREST to keep the pixels)...')
oc = Image.open(os.path.join(ROOT, 'IMG_4470.gif'))
ocn = oc.n_frames
for j in range(12):
    oc.seek(round(j * ocn / 12) % ocn)
    fr = oc.convert('RGB').resize((1080, 540), Image.NEAREST)
    fr = punch(fr.convert('RGBA'), 1.16, 1.0).convert('RGB')
    fr.save(os.path.join(OUT, f'ocean{j}.jpg'), quality=86, optimize=True)
    manifest[f'ocean{j}'] = {'w': 1080, 'h': 540, 'ext': 'jpg'}
print(f"  ocean0..11: {sum(os.path.getsize(os.path.join(OUT, f'ocean{j}.jpg')) for j in range(12))//1024}KB")

print('animated backgrounds...')
# sunny surface: 1000x500 -> cover 960x540 (scale to 1080x540, center crop)
# deep water: crop the signature band off the top, keep a tall slab for parallax
gif_frames('IMG_4439.gif', 'bg_deep', 8, box=(0, 130, 1300, 1300), target=(1440, 1296))
# god rays band
gif_frames('IMG_4438.webp', 'bg_rays', 6, target=(1440, 552))

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f)
print(f'\n{len(manifest)} assets written to assets/')
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) / 1048576
print(f'total size: {total:.1f} MB')

with open(os.path.join(OUT, 'manifest.js'), 'w') as f:
    f.write('// generated by dev/process-assets.py\nconst ASSET_MANIFEST = ' + json.dumps(manifest) + ';\n')
print('manifest.js written')
