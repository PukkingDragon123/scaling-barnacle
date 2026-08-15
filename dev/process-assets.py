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


def global_key(im, tol=34, bg_col=None):
    """Remove EVERY pixel near the sheet background, not just the border-connected
    ones — sprite sheets trap background inside enclosed shapes (between beams,
    under a roof) that a flood fill can never reach.

    Pass bg_col when the image has ALREADY been through key_bg: its corners are
    transparent by then, so corner sampling would key against black instead and
    eat the artwork's outlines while leaving the trapped background behind."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    if bg_col is not None:
        br, bg, bb = bg_col
    else:
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


def punch_interior(im, bg_col, tol=12, edge_tol=24, core=2):
    """Delete background TRAPPED INSIDE the artwork, and only that.

    key_bg floods from the border, so it can never reach a pocket the drawing
    encloses -- the gaps between stair treads, the open space under a stilt house
    between its legs, and every square between a ladder's rungs. Those shipped as
    solid grey slabs, which is why a ladder looked like a grey plank with brown
    stripes painted on it.

    FINDING THEM IS EASY. NOT EATING THE ARTWORK IS THE JOB. Measured on the
    cottage, against a key colour of (155,160,176):

        trapped pocket under the deck      distance   5.8
        trapped gap between stair treads   distance   7.5
        the cream plank wall               distance  49.4

    An order of magnitude apart -- so the old tol=34 (which passes anything
    within 59) took the whole wall and the house came out looking moth-eaten.
    Three things keep this honest:

      * TIGHT SEEDS. `tol` only has to admit the flat background, and 12 does
        that with room to spare while staying miles clear of any real paint.
      * HYSTERESIS. Anti-aliasing puts a rim of half-background around every
        pocket, too blended for the tight threshold. `edge_tol` grows the punch
        outward through those, but ONLY from a pixel already proven background --
        a blended pixel that is not connected to a seed is somebody's shading and
        is left alone.
      * A THICKNESS GATE. A pocket is an AREA; a plank shadow is a LINE. A blob
        is only punched if it contains a solid (2*core+1) square of its own kind,
        which a groove of any length never does.

    core=2 (a 5x5 core), and it stays 2. I dropped it to 1 to chase what looked
    like a grey halo around house_body's door -- and that "halo" is the house's
    own WHITEWASHED DOOR SURROUND. A 3x3 core is small enough for a pale painted
    trim to qualify as an area, so the punch ate straight through the frame and
    left a ragged hole with white crumbs round it. Before/after on magenta made
    it obvious in one look. The lesson is the one this function's docstring keeps
    relearning: near the key colour is not the same as being the key colour, and
    when the two are genuinely close, the only safe gate is a coarse one.
    """
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    br, bg_, bb = bg_col
    t2 = tol * tol * 3
    e2 = edge_tol * edge_tol * 3
    near = bytearray(w * h)     # the loose mask: candidate pixels
    seed = bytearray(w * h)     # the tight mask: certainly background
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            d = (r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2
            if d < e2:
                near[row + x] = 1
                if d < t2:
                    seed[row + x] = 1

    # the thickness gate, measured on the SEEDS: a groove has no solid core
    k = core
    thick = bytearray(w * h)
    for y in range(k, h - k):
        row = y * w
        for x in range(k, w - k):
            if not seed[row + x]:
                continue
            solid = True
            for dy in range(-k, k + 1):
                r2 = (y + dy) * w
                for dx in range(-k, k + 1):
                    if not seed[r2 + x + dx]:
                        solid = False
                        break
                if not solid:
                    break
            if solid:
                thick[row + x] = 1

    visited = bytearray(w * h)
    for i in range(w * h):
        if not near[i] or visited[i]:
            continue
        stack = [i]
        visited[i] = 1
        blob = []
        has_seed = False
        has_core = False
        while stack:
            j = stack.pop()
            blob.append(j)
            if seed[j]:
                has_seed = True
            if thick[j]:
                has_core = True
            jx, jy = j % w, j // w
            if jx > 0 and near[j - 1] and not visited[j - 1]:
                visited[j - 1] = 1; stack.append(j - 1)
            if jx < w - 1 and near[j + 1] and not visited[j + 1]:
                visited[j + 1] = 1; stack.append(j + 1)
            if jy > 0 and near[j - w] and not visited[j - w]:
                visited[j - w] = 1; stack.append(j - w)
            if jy < h - 1 and near[j + w] and not visited[j + w]:
                visited[j + w] = 1; stack.append(j + w)
        if has_seed and has_core:
            for j in blob:
                px[j % w, j // w] = (0, 0, 0, 0)
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


def gutters(im, axis, want, min_run=2):
    """Find the cut lines between cells by looking for EMPTY rows/columns.

    A nominal grid assumes every sprite fits inside its cell. Real sheets do not
    oblige: an outstretched tail or a wide sway overhangs, and slicing on the
    nominal line cuts it off — or, with an inset, cuts the sprite and then
    biggest_blob throws away the severed flipper. Both were happening (the whale
    swallowed its neighbour, the spin frames lost tails, a seed packet came out as
    a corner fragment).

    So: project alpha onto one axis, find the runs of blank, and cut through the
    middle of each. Returns `want`+1 boundaries, or None if the sheet does not
    actually have that many gutters — in which case the caller falls back to the
    nominal grid rather than guessing.
    """
    w, h = im.size
    px = im.load()
    n = w if axis == 'x' else h
    other = h if axis == 'x' else w
    # step the scan: exact counts are not needed, only "is anything here"
    step = max(1, other // 200)
    occupied = bytearray(n)
    for i in range(n):
        for j in range(0, other, step):
            a = px[i, j][3] if axis == 'x' else px[j, i][3]
            if a > 24:
                occupied[i] = 1
                break
    runs = []
    start = None
    for i in range(n):
        if not occupied[i]:
            if start is None:
                start = i
        elif start is not None:
            if i - start >= min_run:
                runs.append((start, i))
            start = None
    if start is not None and n - start >= min_run:
        runs.append((start, n))
    # interior gutters only: leading and trailing blank is just margin
    inner = [r for r in runs if r[0] > 0 and r[1] < n]
    if len(inner) != want - 1:
        return None
    cuts = [0]
    for a, b in inner:
        cuts.append((a + b) // 2)
    cuts.append(n)
    return cuts


def grid_slice(src, cols, rows, names, tol=34, target_h=None, target_w=None,
               solo=False, defr=False, inset=0, gutter=True, punch_bg=None):
    im = key_bg(Image.open(os.path.join(ROOT, src)), tol)
    if defr:
        im = defringe(im)
    w, h = im.size
    # Prefer cutting on the sheet's real gutters; fall back to the nominal grid
    # when the sheet does not present the expected number of them.
    ys = gutters(im, 'y', rows) if gutter and rows > 1 else None
    if ys is None:
        ys = [round(r * h / rows) for r in range(rows + 1)]
    # Column gutters are found PER ROW. A sprite in row 0 may overhang to the left
    # while one in row 2 overhangs right, so no single column of blank runs the
    # whole sheet height — but inside one row band the gutters are clean.
    nominal_x = [round(c * w / cols) for c in range(cols + 1)]
    xs_by_row = []
    for r in range(rows):
        gx = None
        if gutter and cols > 1 and ys[r + 1] > ys[r]:
            gx = gutters(im.crop((0, ys[r], w, ys[r + 1])), 'x', cols)
        xs_by_row.append(gx if gx else nominal_x)
    i = 0
    for r in range(rows):
        xs = xs_by_row[r]
        # a gutter cut already clears the art; an inset would eat into the sprite
        ins = 0 if xs is not nominal_x else inset
        for c in range(cols):
            if i >= len(names):
                break
            box = (xs[c] + ins, ys[r] + ins, xs[c + 1] - ins, ys[r + 1] - ins)
            cell = im.crop(box)
            # biggest_blob only when we had to guess the cut. On a gutter cut the
            # cell holds exactly one sprite already, and culling to the largest
            # blob is precisely what was deleting detached tails and flippers.
            if solo and xs is nominal_x:
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
                # A FRAME HAS HOLES IN IT. A watering can's handle loop, a
                # basket's mouth, a cutlass's knuckle guard: the border flood
                # cannot reach any of them, so they shipped as solid studio grey.
                # `punch` names the key colour for the sheet and punch_interior
                # takes only the enclosed pockets (see its docstring for why a
                # flat colour key eats the artwork and this does not).
                if punch_bg is not None:
                    cell = punch_interior(cell, punch_bg)
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
# the stilts are the pier's job — keep only the hut and the boards it stands on,
# then upscale so the detail holds at a bigger on-screen size

print('houses (already background-free) + workbench prop...')
hut = trim(Image.open(os.path.join(ROOT, '044A2D24-7F4F-4661-A7BB-C5E89EC3CD66-removebg-preview.png')).convert('RGBA'))
save('hut_full', hut)
# the room itself: crop away the stilts, keep the porch floor and everything above

hx2 = trim(Image.open(os.path.join(ROOT, '840E2071-1BC2-437D-BF2C-FE6478FF1DA3-removebg-preview.png')).convert('RGBA'))
house_clean = hx2.resize((round(hx2.size[0] * 1.8), round(hx2.size[1] * 1.8)), Image.LANCZOS)
# Just the building: everything above the sprite's own deck (its top row is 277
# of 598, so cut at 274 to clear the boards) and right of its stair rail (x 264).
# The pier is then the only deck in the scene, so the two can't disagree about
# plank style, post spacing or deck thickness.
# The house on the pier. trim() cuts on alpha > 0, and defringe leaves a haze of
# almost-transparent pixels off the right edge, so it was keeping an 81px dead
# margin on a 528px sprite -- the house then drew at 60% of the width the scene
# gives it and read as a shed pushed to one side. Cut on a real alpha threshold.
def _solid_trim(im, thr=8):
    a = im.split()[3]
    w, h = im.size
    xs = [x for x in range(w) if a.crop((x, 0, x + 1, h)).getextrema()[1] > thr]
    ys = [y for y in range(h) if a.crop((0, y, w, y + 1)).getextrema()[1] > thr]
    if not xs or not ys:
        return im
    return im.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))

save('house_body', _solid_trim(house_clean.crop((264, 0, house_clean.size[0], 274))))

wb = defringe(trim(global_key(Image.open(os.path.join(ROOT, 'IMG_4468.jpeg')), 48)), tol=88, passes=3)
save('workbench', wb)


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

print('the new house interior...')
# Two-stage key: a border fill clears the outside, then a TIGHT global pass with
# the sheet colour passed in explicitly clears the grey trapped under the stairs,
# between the stilts and in the window pane. The tight tolerance is what keeps
# the rope wraps from getting pinholed.
IN2_BG = (152, 155, 164)
in2 = global_key(key_bg(Image.open(os.path.join(ROOT, 'IMG_4496.jpeg')), tol=48), 27, IN2_BG)
in2 = trim(despeckle(defringe(in2, IN2_BG, tol=40, passes=1)))
in2 = in2.resize((1400, round(in2.size[1] * 1400 / in2.size[0])), Image.LANCZOS)
save('house_in2', in2)

print('corals and seaweeds (components)...')
CORAL_BG = (157, 162, 176)
cr = defringe(key_bg(Image.open(os.path.join(ROOT, '3BC01B54-D550-415E-A786-968C86546D91.png')), tol=44),
              CORAL_BG, tol=44, passes=1)
for i, b in enumerate(components(cr, min_area=700)):
    cell = trim(cr.crop(tuple(b)))
    if cell.size[1] > 132:
        s = 132 / cell.size[1]
        cell = cell.resize((max(1, round(cell.size[0] * s)), 132), Image.LANCZOS)
    save(f'coral_{i}', cell)

# ---- crops: 5 species x [sprout, growing, mature, produce, seed] -------------
CROP_KEYS = ['gourd', 'curl', 'berry', 'blade', 'moon']
crop_names = []
for k in CROP_KEYS:
    crop_names += [f'crop_{k}_0', f'crop_{k}_1', f'crop_{k}_2', f'crop_{k}_p', f'crop_{k}_seed']
print('crops (5 species x 5 stages)...')
grid_slice('A80F475C-2484-46A0-8655-228B7A624E51.png', 5, 5, crop_names,
           tol=44, target_h=150, solo=True, defr=True, inset=6)

# ---- livestock: 3 species x [3 baby, 3 adult, 3 producing, product] ----------
STOCK_KEYS = ['puffer', 'sunfish', 'hogfish']
stock_names = []
for k in STOCK_KEYS:
    stock_names += [f'stock_{k}_{i}' for i in range(9)] + [f'stock_{k}_p']
print('livestock (3 species x 10)...')
grid_slice('9D9FDC0A-6FE8-430E-896F-AF6DEEB9A92A.png', 10, 3, stock_names,
           tol=44, target_h=150, solo=True, defr=True, inset=5)

# ---- NPCs: 4x4 character sheets on navy. Tolerance stays low or the navy eats
#      the dark outlines and the professor's waistcoat.
for src, prefix in (('B59D6D33-8796-4EF1-9102-8ADE55B876AF.png', 'prof'),
                    ('720D6322-D87E-40A4-BC5B-1B7B764BB31A.png', 'angler'),
                    ('0CF8013A-DF6F-491C-AB9F-F0E7F1E31356.png', 'farmer')):
    print(f'{prefix} (4x4)...')
    grid_slice(src, 4, 4, [f'{prefix}_{i}' for i in range(16)],
               tol=26, target_h=300, solo=True, inset=6)

print('the crab punk (4x3)...')
grid_slice('IMG_4504.jpeg', 4, 3, [f'crab_{i}' for i in range(12)],
           tol=26, target_h=340, solo=True, inset=6)

# ============================================================================
# The open ocean: side-scroll scenery, swim/hurt/tool animation, resource nodes,
# crafting stations, tameable animals, NPC houses and the dolphin cast.
# Navy sheets keep tol low (26) — Otto's fur and the outlines sit close to it.
# ============================================================================

print('side-scroll ocean scenery...')
# The painted backdrop is a photo-like webp; it needs no keying, just resizing to
# something the parallax can tile without a huge blit cost.
sea = Image.open(os.path.join(ROOT, 'IMG_4522.webp')).convert('RGB')
sea = sea.resize((1440, round(sea.size[1] * 1440 / sea.size[0])), Image.LANCZOS)
sea = punch(sea.convert('RGBA'), 1.18, 1.0).convert('RGB')
sea.save(os.path.join(OUT, 'sea_bg.jpg'), quality=88, optimize=True)
manifest['sea_bg'] = {'w': sea.size[0], 'h': sea.size[1], 'ext': 'jpg'}
print(f"  sea_bg: {sea.size[0]}x{sea.size[1]} ({os.path.getsize(os.path.join(OUT, 'sea_bg.jpg'))//1024}KB)")

mid = Image.open(os.path.join(ROOT, 'IMG_4524.png')).convert('RGB')
mid = punch(mid.convert('RGBA'), 1.16, 1.0).convert('RGB')
mid.save(os.path.join(OUT, 'sea_mid.jpg'), quality=88, optimize=True)
manifest['sea_mid'] = {'w': mid.size[0], 'h': mid.size[1], 'ext': 'jpg'}
print(f'  sea_mid: {mid.size[0]}x{mid.size[1]}')

print('Otto: swim / hurt / tools / combat / crack (navy sheets)...')
grid_slice('9C058CDE-C7DA-4916-B905-8F1BAD1ED885.jpeg', 4, 4,
           [f'oswim_{i}' for i in range(16)], tol=26, target_h=190, solo=True, inset=5)
grid_slice('CF2B9BD3-03A3-40E1-AFFA-93C3CC359549.jpeg', 4, 4,
           [f'ohurt_{i}' for i in range(16)], tol=26, target_h=190, solo=True, inset=5)
grid_slice('IMG_4528.jpeg', 4, 1,
           [f'opick_{i}' for i in range(4)], tol=26, target_h=260, solo=True, inset=6)
grid_slice('472E83F4-1956-463F-81CD-0B11F7B10228.png', 4, 4,
           [f'otool_{i}' for i in range(16)], tol=26, target_h=250, solo=True, inset=6)
grid_slice('585411A1-F117-42B7-B968-B36954F55F9A.png', 4, 4,
           [f'ofight_{i}' for i in range(16)], tol=26, target_h=250, solo=True, inset=6)
grid_slice('BDA9CC36-27B3-48E2-ABD9-D4694E736D21.jpeg', 4, 2,
           [f'ocrack_{i}' for i in range(8)], tol=26, target_h=230, solo=True, inset=6)

print('the dolphin cast...')
grid_slice('4494D865-36C4-409D-8081-AFFC9F4407E2.png', 4, 4,
           [f'dking_{i}' for i in range(16)], tol=26, target_h=300, solo=True, inset=6)
grid_slice('5BC26E90-9428-4352-87CB-DD55D2B3B3CA.png', 4, 4,
           [f'dfarm_{i}' for i in range(16)], tol=26, target_h=300, solo=True, inset=6)

print('seabed resource nodes and resource icons...')
grid_slice('ECF92C7E-C2C6-419B-88F1-54677C25A7B6.png', 4, 2,
           ['node_wood', 'node_stone', 'node_iron', 'node_gold',
            'node_crystal', 'node_coal', 'node_scrap', 'node_wreck'],
           tol=44, target_h=190, solo=True, defr=True, inset=6)
grid_slice('B5914D75-909C-4C2D-8A1F-C1F66B237242.png', 4, 2,
           ['res_driftwood', 'res_stone', 'res_ore', 'res_crystal',
            'res_plank', 'res_nail', 'res_ingot', None],
           tol=44, target_h=150, solo=True, defr=True, inset=6)

print('crafting stations, weapons, farm tools...')
grid_slice('B61CD705-62F4-492C-BF81-67C8CC7F703F.png', 2, 2,
           ['tbl_anvil', 'tbl_bench', 'tbl_mill', 'tbl_forge'],
           tol=44, target_h=240, solo=True, defr=True, inset=8)
grid_slice('62451256-5BAA-4CD6-BD4C-EFD42333B1EC.png', 2, 2,
           ['wpn_flint', 'wpn_cannon', 'wpn_cutlass', 'wpn_bomb'],
           tol=44, target_h=200, solo=True, defr=True, inset=8, punch_bg=(152, 159, 177))
grid_slice('C00A1CE6-2BF7-4E2C-B253-F539283F9CE5.png', 4, 3,
           [f'ftool_{i}' for i in range(12)],
           tol=44, target_h=170, solo=True, defr=True, inset=6, punch_bg=(152, 159, 177))

print('NPC houses and the pirate ship...')
grid_slice('BAB4BD72-E265-418D-9C0E-99B625B95BB5.png', 3, 1,
           ['nhouse_light', 'nhouse_cottage', 'nhouse_shack'],
           tol=44, target_h=520, solo=True, defr=True, inset=8)
# A stilt house is a frame too: the flood reaches the sky around it and nothing
# else. The stair gaps and the whole open underside between the legs shipped as
# solid grey slabs -- that is the "stacking" in the neighbourhood scene.
for _nh in ('nhouse_light', 'nhouse_cottage', 'nhouse_shack'):
    _p = os.path.join(OUT, _nh + '.png')
    save(_nh, trim(punch_interior(Image.open(_p), (155, 160, 176))))
SHIP_BG = (151, 157, 172)
shipim = defringe(key_bg(Image.open(os.path.join(ROOT, '44A4DA02-2501-46EC-BA19-F213DB2864B5.png')), tol=44),
                  SHIP_BG, tol=44, passes=1)
save('ship', despeckle(trim(shipim)))

# ---- tameable animals: three sheets, each 3 species x [3 baby, 3 adult, product]
TAME_SHEETS = [
    ('468F084A-E29C-41A0-B479-615D13736757.png', ['bison', 'melon', 'ray'], 6),
    ('70377945-52A4-45D7-B60B-49A836EFF0E6.png', ['pig', 'cow', 'clown'], 7),
    ('F26797FE-CF5E-4AA0-83C2-B8099A58A731.png', ['whale', 'clam', 'narwhal'], 7),
]
for src, keys, cols in TAME_SHEETS:
    names = []
    for k in keys:
        names += [f'tame_{k}_{i}' for i in range(6)]
        if cols == 7:
            names.append(f'tame_{k}_p')
    print(f'tameables {"/".join(keys)}...')
    grid_slice(src, cols, 3, names, tol=44, target_h=150, solo=True, defr=True, inset=5)

# The bison/melon/ray sheet has no product column, so give them one from an adult
# frame — the game needs a product icon for every tameable species.
for k, alt in (('bison', 'res_driftwood'), ('melon', 'crop_gourd_p'), ('ray', 'shell_scallop')):
    src_name = f'tame_{k}_4'
    if src_name in manifest:
        im = Image.open(os.path.join(OUT, src_name + '.png')).convert('RGBA')
        s = 110 / max(1, im.size[1])
        save(f'tame_{k}_p', im.resize((max(1, round(im.size[0] * s)), 110), Image.LANCZOS))

print('pickaxe tiers and crafting materials...')
# Nine well-separated items, so components beats a grid. tol stays LOW (20): the
# sea glass is translucent and pale, and at 34 the flood fill walks in through its
# soft edges and hollows every shard out into an outline.
PICK_SHEET = defringe(key_bg(Image.open(os.path.join(ROOT, 'IMG_4543.jpeg')), tol=20),
                      (148, 153, 172), tol=26, passes=1)
# components() returns boxes in scan order: row 1 left-to-right, then row 2
PICK_NAMES = ['pick_stone', 'pick_iron', 'pick_crystal', 'res_beam', 'res_ball',
              'res_pot', 'res_glass', 'res_lens', 'res_sand']
_pboxes = components(PICK_SHEET, min_area=900)
for _i, _b in enumerate(_pboxes):
    if _i >= len(PICK_NAMES):
        break
    _cell = trim(PICK_SHEET.crop(tuple(_b)))
    if _cell.size[1] > 180:
        _s = 180 / _cell.size[1]
        _cell = _cell.resize((max(1, round(_cell.size[0] * _s)), 180), Image.LANCZOS)
    save(PICK_NAMES[_i], despeckle(_cell))


# ---- driftwood, broken up ------------------------------------------------------
# res_driftwood is a BUNDLE: three logs tied with rope. As an inventory icon a
# bundle is right (it is a stack of the stuff), but the ocean scatters it as
# scenery that is supposed to be adrift, and a neatly tied bundle bobbing in open
# water reads as cargo somebody lost rather than as driftwood.
#
# So the bundle is cut into its three logs. The crops are measured off the alpha
# map: the upright log occupies the top-centre, the long diagonal runs across the
# middle, and the short one sits bottom-left. Each is trimmed to its own content
# and keyed against the same background, so they come out as three loose pieces
# that can be strewn at different sizes and angles.
_dw = Image.open(os.path.join(OUT, 'res_driftwood.png')).convert('RGBA')
# The rope crosses the middle (roughly x 50..95, y 60..110), so the cuts stay
# clear of it: the upright above it, and the two clean ends of the long log
# either side.
_DW_CUTS = [
    ('drift_0', (64, 0, 124, 62)),      # the upright, top-centre
    ('drift_1', (98, 68, 157, 114)),    # the long log's right end
    ('drift_2', (0, 78, 52, 124)),      # ... and its left end
]
for _n, _box in _DW_CUTS:
    _c = trim(_dw.crop(_box))
    if _c.size[0] > 2 and _c.size[1] > 2:
        save(_n, despeckle(_c))


# ---- the August upload: ores, weeds, dock kit, item icons ----------------------
# Four sheets, all laid out as free-standing objects on a flat field, so connected
# components is the right cut -- no grid to guess and no gutters to find. Boxes
# come back in scan order, which is not reading order, so each sheet sorts its own
# boxes into rows first (bucketing by centre-y against a row tolerance) and then
# left-to-right inside each row. That is what makes the name lists below line up
# with what you see when you open the file.
def _sheet_objects(path, bg_tol, names, row_tol=90, min_area=1400, cap=None, dfbg=None,
                   punch_bg=None):
    im = key_bg(Image.open(os.path.join(ROOT, path)), tol=bg_tol)
    if dfbg is not None:
        im = defringe(im, dfbg, tol=bg_tol + 24, passes=2)
    boxes = components(im, min_area=min_area)
    rows = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        for r in rows:
            if abs(r[0] - cy) < row_tol:
                r[1].append(b)
                break
        else:
            rows.append([cy, [b]])
    rows.sort(key=lambda r: r[0])
    ordered = []
    for _, rb in rows:
        rb.sort(key=lambda b: b[0])
        ordered.extend(rb)
    out = []
    for i, b in enumerate(ordered):
        if i >= len(names) or (cap and i >= cap):
            break
        cell = trim(im.crop(tuple(b)))
        if cell.size[0] < 4 or cell.size[1] < 4:
            continue
        if cell.size[1] > 200:
            sc = 200 / cell.size[1]
            cell = cell.resize((max(1, round(cell.size[0] * sc)), 200), Image.LANCZOS)
        if punch_bg is not None:
            cell = punch_interior(cell, punch_bg)
        save(names[i], despeckle(cell))
        out.append(names[i])
    return out

# ORE NODES. Bright, chunky, and each one sits on a FLAT BASE -- which is exactly
# what a rock resting on the seabed needs, and what the old node art lacked.
_sheet_objects('2B4D10F5-69D6-4D2A-9CA2-C323904D7D28.png', 30, [
    'ore_stone', 'ore_copper', 'ore_gold', 'ore_crystal', 'ore_coal', 'ore_scrap',
], row_tol=180, min_area=4000)

# SEAWEED. Twelve plants, all rooted at the bottom of their own cell, so they can
# be planted on the sand with the base as the anchor.
_sheet_objects('B395B479-D087-4DA2-B444-2F4F08F6586B.png', 34, [
    'weed_0', 'weed_1', 'weed_2', 'weed_3',
    'weed_4', 'weed_5', 'weed_6', 'weed_7',
    'weed_8', 'weed_9', 'weed_10', 'weed_11',
], row_tol=160, min_area=3000)

# THE DOCK KIT: everything you can build out on the planks, including the barn.
# Every one of these is a FRAME -- a ladder, a rail, a trestle, a ramp -- so the
# border flood can reach almost none of the background in them. Unpunched, the
# ladder shipped as a grey plank with rungs painted on it.
_sheet_objects('CF64917A-4B5D-4D7A-8DE9-9BEC0F6EA47C.png', 30, [
    'kit_barn', 'kit_pavilion', 'kit_hoist',
    'kit_hayloft', 'kit_ropefence', 'kit_trough', 'kit_ramp',
    'kit_deck', 'kit_trestle', 'kit_ladder', 'kit_rail', 'kit_lamp', 'kit_mooring',
], row_tol=150, min_area=3000, punch_bg=(152, 159, 177))

# ITEM ICONS, on magenta.
_sheet_objects('27DA4A95-FE40-4173-B479-B244453D2273.png', 60, [
    'ic_logs', 'ic_rope', 'ic_coalsack', 'ic_ingots',
    'ic_flask', 'ic_tea', 'ic_chowder', 'ic_skewer',
    'ic_grill', 'ic_rolls', 'ic_barrel', 'ic_coop',
    'ic_scarecrow', 'ic_pen', 'ic_cannon',
    'ic_kelp', 'ic_oyster', 'ic_pineapple', 'ic_steak',
    'ic_snail', 'ic_coral', 'ic_crate',
], row_tol=110, min_area=2500)


# ---- the lush-farm upload: beds, seaweed, seed packets, crops, real sand -------
# Six sheets that between them replace the coded farm and dress the whole seabed.

# FARM BEDS (20C22AC7): two rows of five widths. The top row is the plain sandy
# bed; the bottom is the ornate gold-and-pearl one, which the game uses as the
# READY state -- a bed that dresses itself up when the crop comes in is a status
# readout that needs no icon. Row-bucketed components, left to right = smallest
# to widest.
_sheet_objects('20C22AC7-5D63-48DD-AF9F-ED7C964079C1.png', 26,
    ['bed_0', 'bed_1', 'bed_2', 'bed_3', 'bed_4',
     'bedr_0', 'bedr_1', 'bedr_2', 'bedr_3', 'bedr_4'],
    row_tol=200, min_area=3000)

# LUSH SCENERY (527D8332): an 8x4 grid -- tall, small, flowering and berried rows
# of eight species. Sliced on gutters like every other regular sheet; named flat,
# row-major: lush_0..7 tall, lush_8..15 small, lush_16..23 flowering,
# lush_24..31 berried.
grid_slice('527D8332-9CE3-47B7-B962-02C9C8A63282.png', 8, 4,
           [f'lush_{i}' for i in range(32)], tol=30, defr=True, inset=0, solo=False)

# SEED PACKETS: eight shell spat bags (829D5CE9) and eight plant seed bags
# (A42CE0A5). The plant packets match the crop sheet below species-for-species,
# in the same order.
_sheet_objects('829D5CE9-FA4F-4717-A28D-DE2B28916EA3.png', 26,
    [f'pack_shell_{i}' for i in range(8)], row_tol=240, min_area=8000)
_sheet_objects('A42CE0A5-85D6-43A2-A878-577DEDB42ED3.png', 26,
    [f'pack_plant_{i}' for i in range(8)], row_tol=240, min_area=8000)

# THE CROPS (DFE68B18): eight species, one per row; the columns are sprout,
# growing, mature-with-fruit, and the harvested BUNDLE -- which is the produce
# icon, drawn by the same hand as the plant it came from. Species keys line up
# with pack_plant_0..7.
SEA_KEYS = ['kelp', 'grass', 'ruby', 'fan', 'bluefan', 'ember', 'jade', 'goldw']
_names2 = []
for _k in SEA_KEYS:
    _names2 += [f'sea_{_k}_0', f'sea_{_k}_1', f'sea_{_k}_2', f'sea_{_k}_p']
grid_slice('DFE68B18-442B-40FC-8055-5E3356AF4787.png', 4, 8, _names2,
           tol=30, defr=True, inset=0, solo=False)

# REAL SAND (726A9C92, on magenta): eighteen bank chunks and two long strips.
# The strips are what the ocean lays along the floor line -- painted sand with
# shells and starfish in it instead of three flat fills.
_sheet_objects('726A9C92-B618-4960-8A9F-705712DAEE34.png', 40,
    [f'sandc_{i}' for i in range(6)] + [f'sandc_{i}' for i in range(6, 12)] +
    [f'sandc_{i}' for i in range(12, 18)] + ['sandstrip_0', 'sandstrip_1'],
    row_tol=140, min_area=6000, dfbg=(251, 2, 251))

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f)
print(f'\n{len(manifest)} assets written to assets/')
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) / 1048576
print(f'total size: {total:.1f} MB')

with open(os.path.join(OUT, 'manifest.js'), 'w') as f:
    f.write('// generated by dev/process-assets.py\nconst ASSET_MANIFEST = ' + json.dumps(manifest) + ';\n')
print('manifest.js written')
