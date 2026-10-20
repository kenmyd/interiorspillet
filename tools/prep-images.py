#!/usr/bin/env python3
"""Prepare every image the game shows (writes public/img/**).

Usage (from the project root, Python 3 + Pillow only):
    py tools/prep-images.py [all|forslag|foto|stue|utsikt] [--debug] [--realign]

  forslag  wall proposal montages <CODE>.jpg, thumb/<CODE>.jpg, oversikt-<group>.jpg, tegning-08/09.png and
           index.json (code -> files + source)                                -> public/img/forslag/
  foto     the room-spec photoCameras photos at 1600x1200                     -> public/img/foto/
  stue     re-encodes public/img/stue.jpg (from the original photo) if it is above 400 kB
  utsikt   window backdrops sor / sor-kveld / ost / nord (+ lav/ half-size versions) and backdrops.json
                                                                              -> public/img/utsikt/
  --debug    also writes intermediate images to .shots/foundation-images/prep/
  --realign  re-estimates the rotation of the side window photos by image alignment (slow, ~2 min)

The window views are built from the real photos in bilder_stue/ (Samsung Galaxy S25 ultra-wide, 4000x3000,
rectilinear after the phone's lens correction, focal length 1600 px). Every photo gets a camera rotation
(yaw from south toward west, pitch, roll) in the game's axes (+x south, +y up, +z west): the reference photo of
each view is solved from the straight edges of the window frame (plus the far shoreline as the horizon where
the frame alone is ambiguous); the other south photos are aligned to it on the distant hills. The photos are
then re-projected into one cylindrical panorama: x linear in azimuth, y linear in tan(elevation), which maps
exactly onto an open cylinder around the photo camera (see backdrops.json -> mapping). Frames, reflections,
objects on the sills and the terrace are removed; the sky becomes a smooth model fitted to the photographed sky.
Takes about 3 minutes; deterministic (fixed seeds).
"""
import json
import math
import os
import re
import sys
import time
from io import BytesIO

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageMath, ImageOps, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS = os.path.join(ROOT, 'bilder_stue')
PROPOSALS = os.path.join(ROOT, 'stue_hoy_vegg_forslag')
OUT = os.path.join(ROOT, 'public', 'img')
DEBUG_DIR = os.path.join(ROOT, '.shots', 'foundation-images', 'prep')

DEBUG = '--debug' in sys.argv
REALIGN = '--realign' in sys.argv

RESAMPLE = Image.Resampling.LANCZOS
BICUBIC = Image.Resampling.BICUBIC


# ----------------------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------------------

def log(*args):
    print(*args, flush=True)


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def save_jpeg(img, path, quality, progressive=True):
    """Save an RGB JPEG (optimised, progressive, 4:2:0) and return its size in bytes."""
    ensure_dir(os.path.dirname(path))
    img.convert('RGB').save(path, 'JPEG', quality=quality, optimize=True, progressive=progressive,
                            subsampling='4:2:0')
    return os.path.getsize(path)


def debug_save(img, name, quality=88):
    if not DEBUG:
        return
    ensure_dir(DEBUG_DIR)
    img.convert('RGB').save(os.path.join(DEBUG_DIR, name), 'JPEG', quality=quality)


def fit_width(img, max_w):
    """Downscale (never upscale) so the width is at most max_w."""
    if img.width <= max_w:
        return img
    h = round(img.height * max_w / img.width)
    return img.resize((max_w, h), RESAMPLE)


def fit_longest(img, max_side):
    """Downscale (never upscale) so the longest side is at most max_side."""
    s = max(img.size)
    if s <= max_side:
        return img
    k = max_side / s
    return img.resize((round(img.width * k), round(img.height * k)), RESAMPLE)


def open_rgb(path):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert('RGB')


def pixels(img):
    """Flat pixel list (Pillow 12+ get_flattened_data, older getdata)."""
    f = getattr(img, 'get_flattened_data', None)
    return list(f() if f else img.getdata())


def rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


# ----------------------------------------------------------------------------------------------------------
# 1. Wall proposal montages
# ----------------------------------------------------------------------------------------------------------

PROPOSAL_RE = re.compile(r'^(\d+)_([A-Z][A-Z0-9]*)(?:_|\.)')


def proposal_code(filename):
    """'0_for.jpg' -> '0', '2_B2_spilevegg_rokt_eik.jpg' -> 'B2', overview sheets -> None."""
    base = os.path.basename(filename)
    if 'oversikt' in base:
        return None
    if re.match(r'^0_for\.', base):
        return '0'
    m = PROPOSAL_RE.match(base)
    return m.group(2) if m else None


def prep_forslag():
    out_dir = os.path.join(OUT, 'forslag')
    thumb_dir = os.path.join(out_dir, 'thumb')
    ensure_dir(thumb_dir)
    index = {'montages': {}, 'overviews': [], 'drawings': []}
    written = []
    for folder in sorted(os.listdir(PROPOSALS)):
        m = re.match(r'^(\d+)_', folder)
        full = os.path.join(PROPOSALS, folder)
        if not m or not os.path.isdir(full):
            continue
        group = int(m.group(1))
        for name in sorted(os.listdir(full)):
            src = os.path.join(full, name)
            low = name.lower()
            if group <= 4 and low.endswith('.jpg'):
                img = open_rgb(src)
                if 'oversikt' in low:
                    dst = os.path.join(out_dir, 'oversikt-%d.jpg' % group)
                    big = fit_longest(img, 1600)
                    save_jpeg(big, dst, 82)
                    index['overviews'].append({'group': group, 'file': 'img/forslag/' + os.path.basename(dst),
                                               'source': rel(src), 'size': list(big.size)})
                    written.append(dst)
                    continue
                code = proposal_code(name)
                if not code:
                    log('  ! skipped (no code):', name)
                    continue
                big = fit_width(img, 1290)
                dst = os.path.join(out_dir, code + '.jpg')
                save_jpeg(big, dst, 84)
                thumb = img.resize((400, round(img.height * 400 / img.width)), RESAMPLE)
                tdst = os.path.join(thumb_dir, code + '.jpg')
                save_jpeg(thumb.filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=2)), tdst, 78)
                index['montages'][code] = {'file': 'img/forslag/%s.jpg' % code, 'thumb': 'img/forslag/thumb/%s.jpg' % code,
                                           'source': rel(src), 'size': list(big.size), 'group': group}
                written += [dst, tdst]
            elif group == 5 and low.endswith('.png'):
                num = re.match(r'^(\d+)_', name)
                if not num:
                    continue
                img = Image.open(src)
                img = fit_longest(img.convert('RGB'), 1600)
                dst = os.path.join(out_dir, 'tegning-%s.png' % num.group(1))
                # Line drawings: an adaptive palette keeps them crisp at a fraction of the size.
                pal = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                pal.save(dst, 'PNG', optimize=True)
                index['drawings'].append({'file': 'img/forslag/' + os.path.basename(dst), 'source': rel(src),
                                          'size': list(img.size)})
                written.append(dst)
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    written.append(os.path.join(out_dir, 'index.json'))
    log('forslag: %d montages, %d overviews, %d drawings' % (len(index['montages']), len(index['overviews']),
                                                               len(index['drawings'])))
    return written


# ----------------------------------------------------------------------------------------------------------
# 2. Photos for the photo comparison
# ----------------------------------------------------------------------------------------------------------

def load_room_spec():
    for p in (os.path.join(ROOT, 'research', 'room-spec.json'), os.path.join(ROOT, 'src', 'data', 'room-spec.json')):
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                return json.load(f)
    raise FileNotFoundError('room-spec.json')


def prep_foto():
    spec = load_room_spec()
    out_dir = os.path.join(OUT, 'foto')
    ensure_dir(out_dir)
    written = []
    for cam in spec.get('photoCameras', []):
        f = cam.get('file', '')
        if not f.startswith('bilder_stue/'):
            continue
        src = os.path.join(ROOT, f)
        if not os.path.exists(src):
            log('  ! missing photo', f)
            continue
        img = open_rgb(src)
        img.thumbnail((1600, 1200), RESAMPLE)
        dst = os.path.join(out_dir, os.path.splitext(os.path.basename(f))[0] + '.jpg')
        save_jpeg(img, dst, 80)
        written.append(dst)
    log('foto: %d photos' % len(written))
    return written


# ----------------------------------------------------------------------------------------------------------
# 4. Start screen photo
# ----------------------------------------------------------------------------------------------------------

def prep_stue(limit=400 * 1024):
    dst = os.path.join(OUT, 'stue.jpg')
    if os.path.exists(dst) and os.path.getsize(dst) <= limit:
        log('stue.jpg: %d kB, left as is' % (os.path.getsize(dst) // 1024))
        return [dst]
    # Re-encode from the original photo when it is there (better than recompressing the copy).
    src = os.path.join(PHOTOS, '20261018_082901.jpg')
    img = open_rgb(src if os.path.exists(src) else dst)
    for width in (1920, 1600, 1440):
        im = fit_width(img, width)
        lo, hi, best = 60, 90, None
        while lo <= hi:
            q = (lo + hi) // 2
            buf = BytesIO()
            im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
            if buf.tell() <= limit - 8 * 1024:
                best, lo = (q, buf.getvalue()), q + 1
            else:
                hi = q - 1
        if best and best[0] >= 74:
            with open(dst, 'wb') as f:
                f.write(best[1])
            log('stue.jpg: %dx%d q%d, %d kB' % (im.width, im.height, best[0], len(best[1]) // 1024))
            return [dst]
    raise RuntimeError('could not fit stue.jpg under the limit')


# ----------------------------------------------------------------------------------------------------------
# 3. Window views – camera model and cylindrical re-projection
# ----------------------------------------------------------------------------------------------------------

F_PX = 1600.0          # focal length of the ultra-wide camera at 4000x3000 (photoCameras.focalPx)
CX, CY = 2000.0, 1500.0


def v_norm(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return (v[0] / l, v[1] / l, v[2] / l)


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cam_basis(yaw, pitch, roll):
    """Camera axes in world space. World: +x south, +y up, +z west. yaw: from south toward west (deg)."""
    p, t, r = math.radians(yaw), math.radians(pitch), math.radians(roll)
    fwd = (math.cos(t) * math.cos(p), math.sin(t), math.cos(t) * math.sin(p))
    right = (-math.sin(p), 0.0, math.cos(p))
    up = v_cross(right, fwd)
    r2 = tuple(right[i] * math.cos(r) + up[i] * math.sin(r) for i in range(3))
    u2 = tuple(-right[i] * math.sin(r) + up[i] * math.cos(r) for i in range(3))
    return fwd, r2, u2


def world_to_cam(d, cam):
    fwd, right, up = cam
    return (v_dot(d, right), -v_dot(d, up), v_dot(d, fwd))


class Pano:
    """Cylindrical panorama: x linear in azimuth (deg, from south toward west), y linear in tan(elevation)."""

    def __init__(self, az0, az1, t0, t1, w, h):
        self.az0, self.az1, self.t0, self.t1, self.w, self.h = az0, az1, t0, t1, w, h

    @property
    def size(self):
        return (self.w, self.h)

    def dir_at(self, x, y):
        az = math.radians(self.az0 + (x / self.w) * (self.az1 - self.az0))
        t = self.t1 - (y / self.h) * (self.t1 - self.t0)
        return (math.cos(az), t, math.sin(az))

    def x_of(self, az):
        return (az - self.az0) / (self.az1 - self.az0) * self.w

    def y_of_e(self, e_deg):
        return (self.t1 - math.tan(math.radians(e_deg))) / (self.t1 - self.t0) * self.h

    def pt(self, az, e):
        return (self.x_of(az), self.y_of_e(e))

    def az_of(self, x):
        return self.az0 + x / self.w * (self.az1 - self.az0)

    def e_of(self, y):
        return math.degrees(math.atan(self.t1 - y / self.h * (self.t1 - self.t0)))

    def scaled(self, k):
        return Pano(self.az0, self.az1, self.t0, self.t1, round(self.w * k), round(self.h * k))


def warp(src, cam_params, pano, mask=None, tile=16, f=F_PX):
    """Re-project a photo (any resolution of the 4000x3000 frame) into `pano`. Returns RGBA (alpha = valid)."""
    scale = src.width / 4000.0
    cam = cam_basis(*cam_params)
    sw, sh = src.size
    cx, cy, ff = CX * scale, CY * scale, f * scale
    rgba = src.convert('RGBA')
    if mask is not None:
        rgba.putalpha(mask.resize(src.size, BICUBIC) if mask.size != src.size else mask)

    def proj(x, y):
        c = world_to_cam(pano.dir_at(x, y), cam)
        if c[2] <= 0.05:
            return None
        return (cx + ff * c[0] / c[2], cy + ff * c[1] / c[2])

    mesh = []
    xs_ = list(range(0, pano.w, tile)) + [pano.w]
    prev = [proj(x, 0) for x in xs_]
    for y0 in range(0, pano.h, tile):
        y1 = min(pano.h, y0 + tile)
        cur = [proj(x, y1) for x in xs_]
        for i in range(len(xs_) - 1):
            a, b, c_, d = prev[i], cur[i], cur[i + 1], prev[i + 1]
            if a is None or b is None or c_ is None or d is None:
                continue
            qx = (a[0], b[0], c_[0], d[0])
            qy = (a[1], b[1], c_[1], d[1])
            if max(qx) < 0 or min(qx) > sw or max(qy) < 0 or min(qy) > sh:
                continue
            mesh.append(((xs_[i], y0, xs_[i + 1], y1), (a[0], a[1], b[0], b[1], c_[0], c_[1], d[0], d[1])))
        prev = cur
    return rgba.transform(pano.size, Image.Transform.MESH, mesh, resample=BICUBIC, fillcolor=(0, 0, 0, 0))


def poly_mask(size, polys, scale=1.0, blur=0):
    """Mask from polygons given in 4000x3000 source coordinates."""
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([(x * scale, y * scale) for x, y in p], fill=255)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def pano_poly_mask(pano, polys, blur=0, value=255, base=None):
    """Mask from polygons given in (azimuth, elevation) degrees."""
    m = base.copy() if base is not None else Image.new('L', pano.size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([pano.pt(a, e) for a, e in p], fill=value)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def hard_alpha(img, thr=250):
    return img.getchannel('A').point(lambda v: 255 if v >= thr else 0)


def shrink_mask(m, px):
    """Erode a binary mask by roughly px pixels (MinFilter needs odd sizes)."""
    if px <= 0:
        return m
    size = 2 * int(px) + 1
    while size > 1:
        s = min(size, 9)
        m = m.filter(ImageFilter.MinFilter(s))
        size -= s - 1
    return m


def grow_mask(m, px):
    if px <= 0:
        return m
    size = 2 * int(px) + 1
    while size > 1:
        s = min(size, 9)
        m = m.filter(ImageFilter.MaxFilter(s))
        size -= s - 1
    return m


def gain_match(img, ref, mask):
    """Per-channel gain so that img matches ref inside mask (RGB images)."""
    a = ImageStat.Stat(img.convert('RGB'), mask).mean
    b = ImageStat.Stat(ref.convert('RGB'), mask).mean
    gains = [max(0.6, min(1.6, b[i] / max(a[i], 1))) for i in range(3)]
    chans = [img.getchannel(i).point(lambda v, g=gains[i]: min(255, round(v * g))) for i in range(3)]
    out = Image.merge('RGB', chans)
    if img.mode == 'RGBA':
        out.putalpha(img.getchannel('A'))
    return out, gains


def seam_path(diff, valid, x0, x1, smooth=1):
    """Dynamic-programming seam (top to bottom) through columns x0..x1 of a difference image.

    diff: 'L' image (difference), valid: 'L' mask (255 where both images are usable). Returns a list with one x
    per row. Invalid pixels are expensive so the seam stays where both sources exist."""
    w, h = diff.size
    x0, x1 = max(0, int(x0)), min(w - 1, int(x1))
    bw = x1 - x0 + 1
    dd = pixels(diff.crop((x0, 0, x1 + 1, h)))
    vv = pixels(valid.crop((x0, 0, x1 + 1, h)))
    cost = [float(dd[i]) + (0.0 if vv[i] > 128 else 400.0) for i in range(len(dd))]
    acc = cost[:bw]
    back = []
    for y in range(1, h):
        row = cost[y * bw:(y + 1) * bw]
        nacc = [0.0] * bw
        brow = [0] * bw
        for x in range(bw):
            best, bx = acc[x], x
            for dx in range(1, smooth + 1):
                if x - dx >= 0 and acc[x - dx] < best:
                    best, bx = acc[x - dx], x - dx
                if x + dx < bw and acc[x + dx] < best:
                    best, bx = acc[x + dx], x + dx
            nacc[x] = best + row[x]
            brow[x] = bx
        acc = nacc
        back.append(brow)
    x = min(range(bw), key=lambda i: acc[i])
    path = [0] * h
    path[h - 1] = x
    for y in range(h - 2, -1, -1):
        x = back[y][x]
        path[y] = x
    return [p + x0 for p in path]


def seam_mask(size, left_path, right_path, scale=1.0):
    """Mask that is 255 between two seam paths (lists of x per row at a smaller scale)."""
    w, h = size
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    n = len(left_path)
    pts_l = [(left_path[i] * scale, i * scale) for i in range(n)] + [(left_path[-1] * scale, h)]
    pts_r = [(right_path[i] * scale, i * scale) for i in range(n)] + [(right_path[-1] * scale, h)]
    poly = [(pts_l[0][0], 0)] + pts_l + list(reversed(pts_r)) + [(pts_r[0][0], 0)]
    d.polygon(poly, fill=255)
    return m


def fill_holes(img, hole, radii=(96, 48, 24, 12, 6, 3), passes=3):
    """Fill the pixels where hole=255 by repeated blur-diffusion of the surrounding pixels (sky, haze)."""
    rgb = img.convert('RGB')
    bb = hole.getbbox()
    if not bb:
        return rgb
    pad = 2 * max(radii)
    box = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(rgb.width, bb[2] + pad), min(rgb.height, bb[3] + pad))
    sub, hs = rgb.crop(box), hole.crop(box)
    keep = ImageOps.invert(hs)
    ring = ImageChops.subtract(grow_mask(hs, 6), hs)
    mean = tuple(int(v) for v in ImageStat.Stat(sub, ring).mean) if ImageStat.Stat(ring).sum[0] else (128, 128, 128)
    out = Image.composite(Image.new('RGB', sub.size, mean), sub, hs)
    for r in radii:
        for _ in range(passes):
            out = Image.composite(sub, out.filter(ImageFilter.GaussianBlur(r)), keep)
    rgb.paste(out, box[:2])
    return rgb


# ----------------------------------------------------------------------------------------------------------
# 3a. South view (sor.jpg)
# ----------------------------------------------------------------------------------------------------------

def photo(name):
    return os.path.join(PHOTOS, '20261018_%s.jpg' % name)


def intersect(l1, l2):
    (x1, y1), (x2, y2) = l1
    (x3, y3), (x4, y4) = l2
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    a = x1 * y2 - y1 * x2
    b = x3 * y4 - y3 * x4
    return ((a * (x3 - x4) - (x1 - x2) * b) / den, (a * (y3 - y4) - (y1 - y2) * b) / den)


# Inner edges of the window frame in 082850 (source pixels), measured on full-resolution crops.
FRAME_850 = {
    'top': ((0, 382), (3500, 42)),
    'bottom': ((510, 2808), (3600, 2925)),
    'left': ((110, 1650), (505, 2800)),
    'right': ((3992, 1500), (3625, 2925)),
}

# Camera rotations (yaw from south toward west, pitch, roll; degrees). 082850 is solved from the frame
# vanishing points above (f = 1600 px makes the two vanishing directions orthogonal to 0.004); the others are
# aligned to 082850 on the distant hills/shoreline (see align_photos()).
CAMS = {
    '082850': (-4.72, -13.71, -2.79),
    '082852': (-43.08, -11.07, -3.58),
    '082843': (-31.70, -8.84, -3.77),
    '082855': (44.35, -9.69, -2.02),
    '082845': (33.74, -9.38, 0.02),
}


def glass_polygon(name):
    """Usable glass area of a window photo (source pixel polygon), frames/sill/room excluded."""
    if name == '082850':
        f = FRAME_850
        # Move each frame line ~40 px into the glass: the frame casts a dark rim and condensation drops.
        off = lambda l, dx, dy: ((l[0][0] + dx, l[0][1] + dy), (l[1][0] + dx, l[1][1] + dy))
        top, bottom = off(f['top'], 0, 45), off(f['bottom'], 0, -30)
        left, right = off(f['left'], 35, 0), off(f['right'], -35, 0)
        return [[intersect(top, left), intersect(top, right), intersect(bottom, right), intersect(bottom, left)]]
    if name == '082852':
        return [[(980, 820), (1130, 780), (1600, 530), (2200, 200), (2440, 0), (4000, 0), (4000, 3000),
                 (1460, 3000), (1300, 2520)]]
    if name == '082855':
        # right part (x > 2660) is veiled by a reflection of the window reveal
        return [[(0, 0), (1420, 0), (2000, 300), (2680, 600), (2930, 640), (2830, 2640), (2360, 3000), (0, 3000)]]
    if name == '082843':
        return [[(660, 880), (980, 760), (1560, 420), (2950, 0), (4000, 0), (4000, 3000), (1000, 3000)]]
    if name == '082845':
        return [[(0, 0), (1500, 0), (2380, 480), (2900, 600), (2860, 2900), (0, 3000)]]
    raise KeyError(name)


def warp_photo(name, pano, extra_mask=None):
    src = open_rgb(photo(name))
    if src.size != (4000, 3000):
        src = src.resize((4000, 3000), RESAMPLE)
    m = poly_mask(src.size, glass_polygon(name))
    if extra_mask is not None:
        m = ImageChops.multiply(m, extra_mask)
    return warp(src, CAMS[name], pano, mask=m)


def build_sor_layers(P):
    """Warp the three main photos and stitch them along minimum-difference seams. Returns RGBA."""
    t = time.time()
    base = warp_photo('082850', P)
    east = warp_photo('082852', P)
    west = warp_photo('082855', P)
    log('  warped 3 photos (%.1fs)' % (time.time() - t))
    # Erode the coverage a little: the frames leave a dark rim and drops of condensation along the edges.
    ab, ae, aw = [shrink_mask(hard_alpha(im), 16) for im in (base, east, west)]
    # 082852 left of -70°: window reveal and a milky reflection of the room.
    ae = ImageChops.multiply(ae, pano_poly_mask(P, [[(-70, 60), (P.az1, 60), (P.az1, -60), (-70, -60)]]))
    # 082855 right of +70°: the reveal; a straight cut keeps the sideways extension in one block
    aw = ImageChops.multiply(aw, pano_poly_mask(P, [[(P.az0, 60), (WEST_CUT, 60), (WEST_CUT, -60), (P.az0, -60)]]))

    # Exposure: match the side photos to the reference where they overlap (far band only).
    band = pano_poly_mask(P, [[(-100, 14), (100, 14), (100, -4), (-100, -4)]])
    east_rgb, ge = gain_match(east.convert('RGB'), base, ImageChops.multiply(ImageChops.multiply(ab, ae), band))
    west_rgb, gw = gain_match(west.convert('RGB'), base, ImageChops.multiply(ImageChops.multiply(ab, aw), band))
    log('  gains east %s west %s' % ([round(g, 3) for g in ge], [round(g, 3) for g in gw]))

    # Seams at quarter resolution.
    k = 0.25
    Ps = P.scaled(k)
    small = lambda im: im.resize(Ps.size, Image.Resampling.BILINEAR)
    gb = small(base.convert('L'))
    seams = {}
    for side, img, a, (az_a, az_b) in (('east', east_rgb, ae, (-56, -42)), ('west', west_rgb, aw, (26, 44))):
        d = ImageChops.difference(gb, small(img.convert('L'))).filter(ImageFilter.GaussianBlur(1.5))
        valid = small(ImageChops.multiply(ab, a)).point(lambda v: 255 if v > 250 else 0)
        seams[side] = seam_path(d, valid, Ps.x_of(az_a), Ps.x_of(az_b), smooth=2)
    keep_base = seam_mask(P.size, seams['east'], seams['west'], scale=1 / k)
    keep_base = ImageChops.multiply(keep_base, ab).filter(ImageFilter.GaussianBlur(3))

    canvas = Image.new('RGBA', P.size, (0, 0, 0, 0))
    w_rgba = west_rgb.convert('RGBA')
    w_rgba.putalpha(aw)
    e_rgba = east_rgb.convert('RGBA')
    e_rgba.putalpha(ae)
    canvas.alpha_composite(w_rgba)
    canvas.alpha_composite(e_rgba)
    b_rgba = base.convert('RGB').convert('RGBA')
    b_rgba.putalpha(keep_base)
    canvas.alpha_composite(b_rgba)
    # Area well inside some photo (≥ 60 px from its frame edge): trusted for the sky model and as a source.
    edges_ok = ImageChops.lighter(ImageChops.lighter(shrink_mask(ab, 50), shrink_mask(ae, 50)), shrink_mask(aw, 50))
    if DEBUG:
        dbg = canvas.copy()
        d = ImageDraw.Draw(dbg)
        for side in seams:
            d.line([(x / k, i / k) for i, x in enumerate(seams[side])], fill=(255, 0, 0, 255), width=3)
        debug_save(Image.alpha_composite(Image.new('RGBA', P.size, (40, 40, 40, 255)), dbg), 'sor-1-stitch.jpg')
    return canvas, edges_ok


def src_to_pano(name, x, y):
    """(azimuth, elevation) in degrees of a source pixel of a window photo."""
    fwd, right, up = cam_basis(*CAMS[name])
    u, v = x - CX, y - CY
    d = v_norm(tuple(fwd[i] * F_PX + right[i] * u - up[i] * v for i in range(3)))
    return math.degrees(math.atan2(d[2], d[0])), math.degrees(math.asin(d[1]))


def ellipse_mask(P, items, grow=1.0):
    """items: [(name, x, y, rx, ry)] in source pixels -> pano mask with the reprojected ellipses."""
    m = Image.new('L', P.size, 0)
    d = ImageDraw.Draw(m)
    px_per_deg = P.w / (P.az1 - P.az0)
    for name, x, y, rx, ry in items:
        az, e = src_to_pano(name, x, y)
        cx, cy = P.pt(az, e)
        k = px_per_deg / (F_PX * math.pi / 180) * grow   # source px -> pano px near the image centre
        d.ellipse([cx - rx * k, cy - ry * k, cx + rx * k, cy + ry * k], fill=255)
    return m


def dehaze(img, region, ref_level=None, strength=0.9, radius=40, valid=None):
    """Remove a smooth veil (reflection in the glass) inside region (soft 'L' mask). Dark-channel style."""
    rgb = img.convert('RGB')
    out_ch = []
    for c in range(3):
        ch = rgb.getchannel(c)
        dark = ch.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MinFilter(9))
        if valid is not None:
            num = ImageChops.multiply(dark, valid).filter(ImageFilter.GaussianBlur(radius))
            den = valid.filter(ImageFilter.GaussianBlur(radius))
            dark = ImageMath.lambda_eval(
                lambda a: a['convert'](a['float'](a['n']) * 255.0 / (a['float'](a['d']) + 0.5), 'L'), n=num, d=den)
        else:
            dark = dark.filter(ImageFilter.GaussianBlur(radius))
        ref = ref_level[c] if ref_level else 30
        haze = dark.point(lambda v, r=ref: max(0, int((v - r) * strength)))
        fixed = ImageMath.lambda_eval(
            lambda a: a['convert']((a['float'](a['c']) - a['float'](a['h'])) * 255.0 / (255.0 - a['float'](a['h'])),
                                   'L'), c=ch, h=haze)
        out_ch.append(fixed)
    out = Image.merge('RGB', out_ch)
    return Image.composite(out, rgb, region)


def soft_disc(size, inner=0.12, blur=0.1):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse([size * inner, size * inner, size * (1 - inner), size * (1 - inner)], fill=255)
    return m.filter(ImageFilter.GaussianBlur(size * blur))


def quilt_fill(img, hole, source, patch, seed, dy_range=None, dx_range=None, step=None, tries=120, passes=2,
               flip=False, min_cover=0.985):
    """Texture synthesis for stochastic content (foliage, lawn): cover `hole` with soft round patches copied
    from places where `source` is 255. The patches come from the same rows (±patch/5) when possible, which
    keeps the perspective scale and the skyline height; when no source fits, the vertical window widens step
    by step up to the whole source. dy_range/dx_range (pixels) override the first search window."""
    import random
    rnd = random.Random(seed)
    src = img.convert('RGB')
    out = src.copy()
    w, h = src.size
    step = step or max(4, int(patch * 0.45))
    disc = soft_disc(patch)
    bb = hole.getbbox()
    sbb = source.getbbox()
    if not bb or not sbb:
        return out
    dy0 = dy_range or (-patch // 5, patch // 5)
    thr = 255 * min_cover
    targets = []
    for p in range(passes):
        off = (step // 2) * p
        for y in range(bb[1] - patch // 2 + off, bb[3], step):
            for x in range(bb[0] - patch // 2 + off, bb[2], step):
                targets.append((x + rnd.randint(-step // 2, step // 2), y + rnd.randint(-step // 2, step // 2)))
    rnd.shuffle(targets)
    missed = 0
    for x, y in targets:
        if not hole.crop((x, y, x + patch, y + patch)).getbbox():
            continue
        done = False
        for attempt in range(tries):
            stage = attempt * 4 // tries                      # 0..3: same rows -> anywhere in the source
            if stage == 0:
                dy = rnd.randint(*dy0)
            elif stage == 1:
                dy = rnd.randint(-patch, patch)
            elif stage == 2:
                dy = rnd.randint(-3 * patch, 3 * patch)
            else:
                dy = rnd.randint(sbb[1] - y, max(sbb[1] - y, sbb[3] - patch - y))
            if dx_range and stage < 3:
                dx = rnd.randint(*dx_range)
            else:
                dx = rnd.randint(sbb[0] - x, max(sbb[0] - x, sbb[2] - patch - x))
            sb = (x + dx, y + dy, x + dx + patch, y + dy + patch)
            if sb[0] < 0 or sb[1] < 0 or sb[2] > w or sb[3] > h:
                continue
            if ImageStat.Stat(source.crop(sb)).mean[0] >= thr:
                piece = src.crop(sb)
                if flip and rnd.random() < 0.5:
                    piece = piece.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                out.paste(piece, (x, y), disc)
                done = True
                break
        missed += not done
    if missed:
        log('  quilt: %d patches without a source' % missed)
    return out


def blend_fill(img, fill, hole, margin):
    """Composite `fill` over `img` in `hole`, cross-fading over `margin` px into the existing content."""
    m = grow_mask(hole, margin // 2).filter(ImageFilter.GaussianBlur(max(1, margin / 3)))
    return Image.composite(fill, img, m)


def stretch_extend(img, P, e_top, e_bottom, side, edge_az, k=2.2, blur_far=7.0, feather_deg=0.8, overlap_deg=2.0):
    """Continue the panorama beyond the last photo by reflecting the outermost real content, stretched k times
    and progressively softened with the distance from the edge: continuous at the edge, no repeated objects,
    and only seen at grazing angles through the windows. Returns (img, mask of the written area)."""
    px_deg = P.w / (P.az1 - P.az0)
    y0, y1 = int(P.y_of_e(e_top)), int(P.y_of_e(e_bottom))
    xe = int(round(P.x_of(edge_az)))
    L = (P.w - xe) if side == 'right' else xe
    if L <= 0:
        return img, Image.new('L', P.size, 0)
    ls = max(2, int(math.ceil(L / k)))
    if side == 'right':
        strip = img.crop((xe - ls, y0, xe, y1)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    else:
        strip = img.crop((xe, y0, xe + ls, y1)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    st = strip.resize((L, y1 - y0), BICUBIC)
    # progressive softening: 0 at the edge -> blur_far px at the far end
    layers = [st] + [st.filter(ImageFilter.GaussianBlur(r)) for r in (blur_far / 3, blur_far * 2 / 3, blur_far)]
    out = layers[0]
    for i, lay in enumerate(layers[1:], start=1):
        ramp = Image.new('L', (L, 1))
        a0, a1 = (i - 1) / 3.0, i / 3.0
        vals = []
        for x in range(L):
            d = x / L if side == 'right' else (L - 1 - x) / L
            t = min(1.0, max(0.0, (d - a0) / (a1 - a0)))
            vals.append(int(255 * t))
        ramp.putdata(vals)
        out = Image.composite(lay, out, ramp.resize(st.size, Image.Resampling.NEAREST))
    layer = img.copy()
    layer.paste(out, (xe, y0) if side == 'right' else (0, y0))
    # cross-fade: the original keeps going ~overlap_deg past the axis (its own reflection fades in under it)
    ov = max(1, int(overlap_deg * px_deg))
    orig = img.crop((xe - ov, y0, xe, y1)) if side == 'right' else img.crop((xe, y0, xe + ov, y1))
    ramp = Image.new('L', (ov, 1))
    ramp.putdata([int(255 * (i / ov if side == 'right' else 1 - i / ov)) for i in range(ov)])
    ramp = ramp.resize(orig.size, Image.Resampling.NEAREST)
    if side == 'right':
        layer.paste(Image.composite(orig, layer.crop((xe, y0, xe + ov, y1)), ImageOps.invert(ramp)), (xe, y0))
    else:
        layer.paste(Image.composite(orig, layer.crop((xe - ov, y0, xe, y1)), ramp), (xe - ov, y0))
    m = Image.new('L', P.size, 0)
    m.paste(255, (xe, y0, P.w, y1) if side == 'right' else (0, y0, xe, y1))
    fth = max(1, int(feather_deg * px_deg)) if feather_deg else 0
    vf = Image.new('L', (1, P.h), 0)
    vf.putdata([0 if (y < y0 or y >= y1) else (255 if not fth else int(255 * min(1.0, (y - y0 + 1) / fth, (y1 - y) / fth)))
                for y in range(P.h)])
    m = ImageChops.multiply(m, vf.resize(P.size, Image.Resampling.NEAREST))
    return Image.composite(layer, img, m), m


def ragged_top(img, S, cov, objects, P, depth_deg=2.5, seed=21):
    """Tree crowns that the photo frame cut off get a wavy, leafy outline instead of the straight cut: per
    column, the top h(x) (1D noise, 0..depth) of the crown is replaced by sky."""
    import random
    rnd = random.Random(seed)
    px_deg = P.w / (P.az1 - P.az0)
    D = int(depth_deg * px_deg)
    tops = column_tops(cov)

    def noise1d(n, cell):
        pts = [rnd.random() for _ in range(n // cell + 3)]
        out = []
        for x in range(n):
            u = x / cell
            i = int(u)
            t = u - i
            t = t * t * (3 - 2 * t)
            out.append(pts[i] * (1 - t) + pts[i + 1] * t)
        return out

    n1, n2, n3 = noise1d(P.w, 90), noise1d(P.w, 23), noise1d(P.w, 6)
    cut = Image.new('L', P.size, 0)
    for x in range(P.w):
        y = tops[x]
        if y >= P.h - D:
            continue
        h = int(D * (0.55 * n1[x] + 0.3 * n2[x] + 0.15 * n3[x]))
        if h > 0:
            cut.paste(255, (x, y, x + 1, y + h))
    cut = ImageChops.multiply(cut.filter(ImageFilter.GaussianBlur(1)), objects)
    return Image.composite(S, img, cut)


def sky_mask(img, P, e_min=2.0):
    """Pixels that look like open sky: bright, not warm-green, smooth."""
    rgb = img.convert('RGB')
    r, g, b = rgb.split()
    lum = rgb.convert('L')
    detail = ImageChops.difference(lum, lum.filter(ImageFilter.GaussianBlur(5))).filter(ImageFilter.GaussianBlur(3))
    smooth = detail.point(lambda v: 255 if v < 4 else 0)
    bright = lum.point(lambda v: 255 if v > 115 else 0)
    blueish = ImageChops.subtract(ImageChops.add(b, Image.new('L', rgb.size, 40)), g).point(
        lambda v: 255 if v > 30 else 0)     # b + 40 - g > 30  <=>  not distinctly green/yellow foliage
    m = ImageChops.multiply(ImageChops.multiply(smooth, bright), blueish)
    top = pano_poly_mask(P, [[(P.az0, 89), (P.az1, 89), (P.az1, e_min), (P.az0, e_min)]])
    return ImageChops.multiply(m, top)


def remove_specks(img, region, P):
    """Remove small dark dirt specks on the glass inside region (sky)."""
    lum = img.convert('L')
    med = lum.filter(ImageFilter.MedianFilter(11))
    dark = ImageChops.subtract(med, lum).point(lambda v: 255 if v > 9 else 0)
    closed = shrink_mask(grow_mask(region, 10), 12)       # closing: the specks themselves are not 'smooth'
    dark = ImageChops.multiply(dark, closed)
    dark = grow_mask(dark, 4)
    if not dark.getbbox():
        return img
    smooth = img.convert('RGB').filter(ImageFilter.MedianFilter(15))
    return Image.composite(smooth, img.convert('RGB'), dark.filter(ImageFilter.GaussianBlur(1.5)))


def object_mask(img, open_px=1):
    """Tree crowns, hills and other solid things against the sky: dark or not bluish. Thin lines (frame rims,
    twigs, specks) are removed by a morphological opening."""
    rgb = img.convert('RGB')
    r, g, b = rgb.split()
    lum = rgb.convert('L')
    dark = lum.point(lambda v: 255 if v < 128 else 0)
    warm = ImageChops.subtract(ImageChops.add(g, Image.new('L', rgb.size, 4)), b).point(lambda v: 255 if v > 0 else 0)
    sat = rgb.convert('HSV').getchannel(1).point(lambda v: 255 if v > 70 else 0)
    mid = lum.point(lambda v: 255 if v < 188 else 0)
    obj = ImageChops.lighter(dark, ImageChops.multiply(warm, ImageChops.lighter(sat, mid)))
    obj = grow_mask(shrink_mask(obj, open_px), open_px)
    return obj.filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: 255 if v > 100 else 0)


def not_sky_mask(img, lum_min=192, sat_max=55):
    """Everything that is not a bright, grey/blue hazy sky (for photos with an overexposed sky)."""
    rgb = img.convert('RGB')
    lum = rgb.convert('L').point(lambda v: 255 if v < lum_min else 0)
    sat = rgb.convert('HSV').getchannel(1).point(lambda v: 255 if v > sat_max else 0)
    obj = ImageChops.lighter(lum, sat)
    obj = grow_mask(shrink_mask(obj, 1), 1)
    return obj.filter(ImageFilter.GaussianBlur(1.0)).point(lambda v: 255 if v > 100 else 0)


def smoothstep_rows(P, e0, e1):
    """'L' mask that is 0 below elevation e0 and 255 above e1 (smooth in between)."""
    col = Image.new('L', (1, P.h))
    vals = []
    for y in range(P.h):
        e = P.e_of(y + 0.5)
        t = min(1.0, max(0.0, (e - e0) / (e1 - e0)))
        vals.append(int(255 * t * t * (3 - 2 * t)))
    col.putdata(vals)
    return col.resize(P.size, Image.Resampling.NEAREST)


def column_tops(mask):
    """Topmost set row per column of a mask (h if the column is empty)."""
    w, h = mask.size
    tops = []
    for x in range(w):
        bb = mask.crop((x, 0, x + 1, h)).getbbox()
        tops.append(bb[1] if bb else h)
    return tops


def solve_linear(A, y):
    """Gaussian elimination for a small dense system A x = y."""
    n = len(A)
    M = [list(A[i]) + [y[i]] for i in range(n)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[piv] = M[piv], M[c]
        if abs(M[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] if abs(M[i][i]) > 1e-12 else 0.0 for i in range(n)]


def sky_model(img, sky, P, az_range=(-50.0, 30.0), e_range=(9.0, 24.0), e_fit_max=25.0):
    """Smooth parametric sky: per channel a quadratic in azimuth and elevation fitted to the clean sky pixels,
    extrapolated linearly above the photos (deeper blue toward the zenith) and clamped at the sides."""
    lo, hi = az_range
    rgb = img.convert('RGB')
    w, h = P.size
    sk = pixels(sky.resize((w // 8, h // 8), Image.Resampling.BOX))
    small = pixels(rgb.resize((w // 8, h // 8), Image.Resampling.BOX))
    sw, sh = w // 8, h // 8

    def feats(az, e):
        a_ = (min(hi, max(lo, az)) - (lo + hi) / 2) / ((hi - lo) / 2)
        t = (e - 15.0) / 10.0
        return [1.0, a_, a_ * a_, t, t * a_, t * t]

    rows, ys = [], ([], [], [])
    for j in range(sh):
        e = P.e_of((j + 0.5) * 8)
        if not (e_range[0] <= e <= e_range[1]):
            continue
        for i in range(sw):
            az = P.az_of((i + 0.5) * 8)
            if not (lo <= az <= hi) or sk[j * sw + i] < 250:
                continue
            c = small[j * sw + i]
            rows.append(feats(az, e))
            for k in range(3):
                ys[k].append(c[k])
    n = len(feats(0, 0))
    if len(rows) < 50:
        raise RuntimeError('too few sky samples (%d)' % len(rows))
    coef = []
    for k in range(3):
        A = [[sum(r[i] * r[j] for r in rows) for j in range(n)] for i in range(n)]
        yv = [sum(r[i] * v for r, v in zip(rows, ys[k])) for i in range(n)]
        coef.append(solve_linear(A, yv))
    log('  sky model: %d samples' % len(rows))

    def color(az, e):
        e = max(e, 0.0)             # below the horizon: horizon colour (no extrapolation)
        ee = min(e, e_fit_max)
        f = feats(az, ee)
        c = [sum(coef[k][i] * f[i] for i in range(n)) for k in range(3)]
        if e > e_fit_max:          # linear continuation with the slope at the top of the data
            f2 = feats(az, e_fit_max - 2)
            c2 = [sum(coef[k][i] * f2[i] for i in range(n)) for k in range(3)]
            c = [c[k] + (c[k] - c2[k]) / 2.0 * (e - e_fit_max) * 0.8 for k in range(3)]
        return tuple(max(0, min(255, int(round(v)))) for v in c)

    return render_sky(color, P), color


def render_sky(color, P, lw=256, lh=128):
    """Render a sky colour function color(az, e) -> (r, g, b) into the panorama P (smooth, bicubic)."""
    w, h = P.size
    out = Image.new('RGB', (lw, lh))
    out.putdata([color(P.az_of((i + 0.5) * w / lw), P.e_of((j + 0.5) * h / lh)) for j in range(lh) for i in range(lw)])
    return out.resize(P.size, BICUBIC)


WEST_CUT = 66.5          # 082855 is used up to this azimuth (the window reveal starts just beyond)
SOR_PANO = (-100.0, 100.0, -0.8391, 0.8391, 4096, 2048)     # az0, az1, tan(bottom), tan(top), w, h  (±40°)

# Terrace deck, its railing, the stair guard and the concrete landing (azimuth, elevation) – built in 3D by the
# exterior, so they are replaced by lawn here.
TERRACE_POLY = [(-101, -3.5), (-69.8, -3.9), (-45.4, -7.1), (-41.1, -7.2), (-40.9, -19.8), (-35.1, -30.0),
                (-34.8, -31.8), (-23.4, -34.9), (-27.2, -41), (-101, -41)]
# Reflections of the room's ceiling lamps in the glass of 082850 (source px: x, y, rx, ry).
BLOBS_850 = [('082850', 1793, 768, 30, 40), ('082850', 1735, 930, 26, 32), ('082850', 1981, 913, 26, 34)]
# Reflection of the LED strip in 082852 (over the forest east of the neighbour's house).
STREAK_852 = [('082852', 1195 + 20 * i, 1103 - 2.4 * i, 18, 13) for i in range(9)]
# Open lawn and the hedge in front of the neighbour's garden (sources for the lawn under the terrace).
LAWN_SOURCES = [[(-40.5, -4.6), (-30, -4.6), (-30, -9.6), (-40.5, -9.6)],
                [(-40.3, -9.6), (-28, -9.6), (-28, -14.0), (-40.3, -14.0)],
                [(-40.3, -14.0), (-27, -14.0), (-27, -28.5), (-35.5, -28.5), (-40.3, -20.5)],
                [(-21, -33.5), (-8, -33.5), (-8, -41), (-21, -41)]]
# Yellow streak (reflection) in the sky of 082852.
GLARE_852 = [[(-62.5, 18.5), (-59.0, 18.5), (-54.2, 10.4), (-57.4, 10.4)]]
# Grass between the bush and the big rock (source for the ground west of the photos).
GRASS_WEST = [[(2, -19), (13, -19), (13, -39), (2, -39)]]


def build_sor():
    """Stitch, clean and extend the south view. Returns (RGB image, Pano, sky colour function)."""
    t0 = time.time()
    P = Pano(*SOR_PANO)
    px_deg = P.w / (P.az1 - P.az0)
    canvas, edges_ok = build_sor_layers(P)
    valid = hard_alpha(canvas, 128)
    img = Image.alpha_composite(Image.new('RGBA', P.size, (128, 128, 128, 255)), canvas).convert('RGB')

    # Veils from reflections in the glass (window reveal in 082855, the room in 082852).
    veil = ImageChops.multiply(pano_poly_mask(P, [[(38, 6), (80, 6), (80, -50), (38, -50)],
                                                  [(-80, 16), (-56, 16), (-56, -6), (-80, -6)]], blur=50), valid)
    img = dehaze(img, veil, valid=valid)

    # Lamp / LED reflections and dirt on the glass.
    img = fill_holes(img, grow_mask(ellipse_mask(P, BLOBS_850, grow=1.25), 4))
    # the LED strip reflected over the forest: forest patches from the same rows
    streak = grow_mask(ellipse_mask(P, STREAK_852, grow=1.3), 4)
    forest = ImageChops.multiply(pano_poly_mask(P, [[(-65, 9), (-56, 9), (-56, 5.6), (-65, 5.6)]]),
                                 ImageOps.invert(grow_mask(streak, 10)))
    img = blend_fill(img, quilt_fill(img, streak, forest, patch=int(1.4 * px_deg), seed=9, flip=True,
                                     dy_range=(-int(4 * px_deg), -int(1 * px_deg)), dx_range=(-int(4 * px_deg), int(6 * px_deg))),
                     streak, 4)
    # the yellow streak crosses the ridge: rebuild it from the clean ridge/sky rows further south
    glare = pano_poly_mask(P, GLARE_852)
    ridge_src = pano_poly_mask(P, [[(-54, 20), (-42, 20), (-42, 8), (-54, 8)]])
    img = blend_fill(img, quilt_fill(img, glare, ridge_src, patch=int(2.2 * px_deg), seed=10), glare, 6)
    img = remove_specks(img, sky_mask(img, P, e_min=3), P)
    debug_save(img, 'sor-2-clean.jpg')

    # Terrace -> lawn: soft patches of the open lawn east of the stair, from the same rows (perspective).
    hole = grow_mask(pano_poly_mask(P, [TERRACE_POLY]), 5)
    lawn_src = ImageChops.multiply(pano_poly_mask(P, LAWN_SOURCES), ImageOps.invert(hole))
    lawn = quilt_fill(img, grow_mask(hole, 6), lawn_src, patch=int(3.0 * px_deg), seed=11, flip=True)
    img = blend_fill(img, lawn, hole, 8)
    valid = ImageChops.lighter(valid, hole)
    debug_save(img, 'sor-3-lawn.jpg')

    # Beyond the photos (east: behind the annex from inside; west: seen at grazing angles from the kitchen):
    # a reflected, stretched and progressively softened continuation of the outermost real content.
    # (082852 is milky from a reflection of the room left of -66°, so the upper rows start there)
    img, m_l = stretch_extend(img, P, 13, 4.4, 'left', -66.0, k=2.0, feather_deg=0)
    xe = int(P.x_of(-69.0))
    ya, yb, yc = int(P.y_of_e(9.0)), int(P.y_of_e(4.4)), int(P.y_of_e(-4.4))
    down = img.crop((0, ya, xe, yb)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((xe, yc - yb), BICUBIC)
    down = down.filter(ImageFilter.GaussianBlur(2))
    hh = yc - yb
    fade = Image.new('L', (1, hh))
    fade.putdata([min(255, int(255 * (hh - 1 - i) / 16)) for i in range(hh)])    # soft into the lawn below
    img.paste(down, (0, yb), fade.resize((xe, hh), Image.Resampling.NEAREST))
    m_l.paste(255, (0, yb, xe, yc))      # (the forest continues down over the rows of the neighbours' houses)
    img, m_r = stretch_extend(img, P, 14, -41, 'right', WEST_CUT, k=2.2)
    valid = ImageChops.lighter(valid, ImageChops.lighter(m_l.point(lambda v: 255 if v else 0),
                                                          m_r.point(lambda v: 255 if v else 0)))
    debug_save(img, 'sor-4-sides.jpg')

    # Sky: a smooth model of the photographed sky. Above ~15° it replaces everything that is not a tree crown
    # or hill (hides exposure steps between the photos, the frame rims and the contrails' cut-offs) and it
    # fills everything above the photos.
    S, sky_color = sky_model(img, ImageChops.multiply(sky_mask(img, P, e_min=8), edges_ok), P)
    debug_save(S, 'sor-sky-model.jpg')
    objects = ImageChops.multiply(object_mask(img), valid)    # crowns / hills, thin frame rims removed
    ramp = smoothstep_rows(P, 11, 17)
    # in the east the glass of 082852 is veiled lower down: the sky model takes over from ~8°
    side_x = Image.new('L', (P.w, 1))
    side_x.putdata([int(255 * min(1.0, max(0.0, (P.az_of(x) + 44) / -8.0))) for x in range(P.w)])
    ramp = Image.composite(smoothstep_rows(P, 7, 11), ramp, side_x.resize(P.size, Image.Resampling.NEAREST))
    img = Image.composite(S, img, ImageChops.multiply(ImageOps.invert(objects).filter(ImageFilter.GaussianBlur(1.5)),
                                                      ramp))
    # Crowns cut by the window frame end with a ragged, leafy outline; above the photos only sky.
    img = ragged_top(img, S, valid, objects, P)
    img = Image.composite(img, S, shrink_mask(valid, 3).filter(ImageFilter.GaussianBlur(1.5)))
    debug_save(img, 'sor-5-sky.jpg')

    # Final grade: the photos are taken through glass – a touch more contrast and colour.
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.07)
    log('  sor built (%.1fs)' % (time.time() - t0))
    return img, P, sky_color


# ----------------------------------------------------------------------------------------------------------
# 3b. Camera rotation from a window frame (vanishing points) and from image alignment
# ----------------------------------------------------------------------------------------------------------

def nelder_mead(fn, x0, step=1.0, iters=400, tol=1e-10):
    """Minimal Nelder-Mead minimiser (no numpy available)."""
    n = len(x0)
    pts = [list(x0)] + [[x0[j] + (step if j == i else 0) for j in range(n)] for i in range(n)]
    vals = [fn(q) for q in pts]
    for _ in range(iters):
        order = sorted(range(n + 1), key=lambda k: vals[k])
        pts, vals = [pts[k] for k in order], [vals[k] for k in order]
        if abs(vals[-1] - vals[0]) < tol:
            break
        c = [sum(q[i] for q in pts[:-1]) / n for i in range(n)]
        xr = [c[i] + (c[i] - pts[-1][i]) for i in range(n)]
        fr = fn(xr)
        if fr < vals[0]:
            xe = [c[i] + 2 * (c[i] - pts[-1][i]) for i in range(n)]
            fe = fn(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = [c[i] + 0.5 * (pts[-1][i] - c[i]) for i in range(n)]
            fc = fn(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                for k in range(1, n + 1):
                    pts[k] = [pts[0][i] + 0.5 * (pts[k][i] - pts[0][i]) for i in range(n)]
                    vals[k] = fn(pts[k])
    k = min(range(n + 1), key=lambda k: vals[k])
    return pts[k], vals[k]


def solve_lines(lines, points=(), guess=(0, 0, 0), w_points=4.0):
    """Camera rotation from straight edges with known world directions and from points with a known elevation.

    lines:  [((x1, y1), (x2, y2)), world_dir]  e.g. a window top edge with (0, 0, 1) (the wall runs along z)
    points: [((x, y), elevation_deg)]          e.g. the far shoreline at the horizon
    Each line's back-projected plane must contain its world direction."""
    def ray(p):
        return v_norm((p[0] - CX, p[1] - CY, F_PX))

    planes = [(v_norm(v_cross(ray(a), ray(b))), dw) for (a, b), dw in lines]

    def err(q):
        cam = cam_basis(*q)
        e = 0.0
        for n, dw in planes:
            e += v_dot(n, world_to_cam(dw, cam)) ** 2
        fwd, right, up = cam
        for (x, y), el in points:
            u, v = x - CX, y - CY
            d = v_norm(tuple(fwd[i] * F_PX + right[i] * u - up[i] * v for i in range(3)))
            e += w_points * (math.asin(d[1]) - math.radians(el)) ** 2
        return e

    q, _ = nelder_mead(err, list(guess), step=3, iters=800, tol=1e-14)
    q, _ = nelder_mead(err, q, step=0.3, iters=800, tol=1e-16)
    return tuple(round(v, 2) for v in q)


def align_photos():
    """Re-estimate CAMS for the side photos by aligning them to 082850 on the far band (slow; --realign)."""
    P = Pano(-110, 110, -0.5, 0.5, 2200, 1000)
    load = lambda n: open_rgb(photo(n)).resize((2000, 1500), RESAMPLE)
    ref = warp(load('082850'), CAMS['082850'], P)
    rg, ra = ref.convert('L'), hard_alpha(ref)
    band = pano_poly_mask(P, [[(P.az0, 14), (P.az1, 14), (P.az1, -3), (P.az0, -3)]])

    def score(src, q):
        out = warp(src, tuple(q), P)
        m = ImageChops.multiply(ImageChops.multiply(hard_alpha(out), ra), band)
        cnt = ImageStat.Stat(m).sum[0] / 255.0
        if cnt < 4000:
            return 1e9
        d = ImageChops.multiply(ImageChops.difference(out.convert('L'), rg), m)
        return ImageStat.Stat(d).sum[0] / 255.0 / cnt

    for name in ('082852', '082843', '082855', '082845'):
        src = load(name)
        q, v = nelder_mead(lambda q: score(src, q), list(CAMS[name]), step=1.0, iters=120, tol=1e-6)
        log('  %s: (%.2f, %.2f, %.2f)  residual %.4f' % (name, q[0], q[1], q[2], v))
        CAMS[name] = tuple(q)


# ----------------------------------------------------------------------------------------------------------
# 3c. Kitchen windows (ost.jpg) and the TV-room strip window (nord.jpg)
# ----------------------------------------------------------------------------------------------------------

# Window frames (inner glass edges) in the photos, measured on full-resolution crops.
FRAME_950 = {   # long kitchen window win-k1 (wall x = 6.32, faces south), from the kitchen island
    'top': ((1460, 668), (3343, 603)),
    'bottom': ((1537, 1540), (3180, 1543)),
    'left': ((1460, 668), (1537, 1540)),
    'right': ((3343, 603), (3278, 1500)),
}
FRAME_800 = {   # strip window win-tv (wall x = 0, faces north), from the TV room
    'top': ((1300, 1247), (2944, 1148)),
    'bottom': ((1306, 1587), (2938, 1612)),
    'left': ((1300, 1247), (1306, 1587)),
    'right': ((2944, 1148), (2938, 1612)),
}


def frame_quad(frame, inset=12):
    """Corners of a frame (tl, tr, br, bl) moved about `inset` px toward the centre."""
    c = [intersect(frame['top'], frame['left']), intersect(frame['top'], frame['right']),
         intersect(frame['bottom'], frame['right']), intersect(frame['bottom'], frame['left'])]
    mx, my = sum(q[0] for q in c) / 4, sum(q[1] for q in c) / 4
    out = []
    for x, y in c:
        d = math.hypot(x - mx, y - my)
        out.append((x + (mx - x) * inset / d * 1.4, y + (my - y) * inset / d * 1.4))
    return out


def sky_silhouette_fill(img, P, sky_rgb, valid, lum_min=214, sat_max=46, close_px=60):
    """Replace a blown-out sky by sky_rgb above the skyline. The skyline is found per column from the top
    (first pixel that is not bright and grey); narrow downward dents (white houses touching the sky) are
    closed so they keep their real pixels. Returns (img, sky alpha)."""
    w, h = P.size
    lum = pixels(img.convert('L'))
    sat = pixels(img.convert('HSV').getchannel(1))
    val = pixels(valid)
    line = []
    for x in range(w):
        y = 0
        while y < h and val[y * w + x] < 128:      # above the photo
            y += 1
        while y < h - 1 and val[y * w + x] >= 128 and lum[y * w + x] >= lum_min and sat[y * w + x] <= sat_max:
            y += 1
        line.append(y)
    # closing from below: remove dips deeper than their neighbours (max over a window, then min)
    r = close_px
    mx = [max(line[max(0, i - r):i + r + 1]) for i in range(w)]
    line2 = [min(line[i], min(mx[max(0, i - r):i + r + 1])) for i in range(w)]
    m = Image.new('L', P.size, 0)
    d = ImageDraw.Draw(m)
    for x in range(w):
        if line2[x] > 0:
            d.line([(x, 0), (x, line2[x] + 1)], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(1.5))
    return Image.composite(sky_rgb, img, m), m


def build_window_view(name, frame, cam, P, removals=(), sky_color=None, extend=(), grade=(1.04, 1.05),
                      dehaze_polys=(), below=None, inset=12):
    """Generic view through one window: rotation from the frame, re-projection into a cylinder, sill objects
    removed (same-row texture patches), blown-out sky replaced by sky_color (same directions as the south
    view: the sky is at infinity), sides continued softly. Returns (img, valid, cam)."""
    px_deg = P.w / (P.az1 - P.az0)
    CAMS[name] = cam
    src = open_rgb(photo(name))
    if src.size != (4000, 3000):
        src = src.resize((4000, 3000), RESAMPLE)
    glass = poly_mask(src.size, [frame_quad(frame, inset)])
    rgba = warp(src, cam, P, mask=glass)
    valid = shrink_mask(hard_alpha(rgba), 4)
    img = Image.alpha_composite(Image.new('RGBA', P.size, (128, 128, 128, 255)), rgba).convert('RGB')
    if dehaze_polys:
        img = dehaze(img, ImageChops.multiply(pano_poly_mask(P, dehaze_polys, blur=30), valid), valid=valid)
    # objects in front of the glass (vases, books, the pampas grass ...): texture from the same rows
    for i, (polys, src_polys) in enumerate(removals):
        hole = poly_mask(src.size, polys)
        hole_p = warp(Image.merge('RGB', [hole] * 3), cam, P).convert('L')
        hole_p = ImageChops.multiply(grow_mask(hole_p.point(lambda v: 255 if v > 20 else 0), 4), valid)
        srcm = ImageChops.multiply(pano_poly_mask(P, src_polys), ImageOps.invert(grow_mask(hole_p, 8)))
        srcm = ImageChops.multiply(srcm, shrink_mask(valid, 4))
        fill = quilt_fill(img, hole_p, srcm, patch=int(1.8 * px_deg), seed=30 + i, flip=True)
        img = blend_fill(img, fill, hole_p, 6)
    if below is not None:          # below(img, valid, P) -> (img, valid): fills outside the glass as well
        img, valid = below(img, valid, P)
    debug_save(img, name + '-1-warp.jpg')
    # sky (above the skyline, and everything above the photo)
    S = render_sky(sky_color, P) if sky_color is not None else None
    if S is not None:
        img, _ = sky_silhouette_fill(img, P, S, valid)
    # sides beyond the photo (stretched, softened)
    for side, e_top, e_bottom, edge_az, k in extend:
        img, m = stretch_extend(img, P, e_top, e_bottom, side, edge_az, k=k)
        valid = ImageChops.lighter(valid, m.point(lambda v: 255 if v else 0))
    if S is not None:
        img = Image.composite(img, S, shrink_mask(valid, 2).filter(ImageFilter.GaussianBlur(1.5)))
    img = ImageEnhance.Contrast(img).enhance(grade[0])
    img = ImageEnhance.Color(img).enhance(grade[1])
    debug_save(img, name + '-2-final.jpg')
    return img, valid, cam


def coverage_az(valid, P, e):
    """(az_left, az_right) of the coverage on the row at elevation e."""
    y = int(P.y_of_e(e))
    bb = valid.crop((0, y, P.w, y + 1)).getbbox()
    return (P.az_of(bb[0]), P.az_of(bb[2])) if bb else (None, None)


OST_PANO = (-60.0, 60.0, -0.6283, 0.6283, 2560, 1536)        # ±32.1° vertically
NORD_PANO = (125.0, 235.0, -0.2679, 0.8391, 2048, 1182)      # -15° ... +40°


def quilt_region(img, valid, P, hole_polys, src_polys, patch_deg, seed, lum_max=255, no_red=False):
    """Fill pano polygons with soft texture patches taken from other pano polygons (any rows). lum_max / no_red
    keep bright water, sky and red houses out of the sources."""
    px_deg = P.w / (P.az1 - P.az0)
    hole = pano_poly_mask(P, hole_polys)
    srcm = ImageChops.multiply(pano_poly_mask(P, src_polys), shrink_mask(valid, 4))
    srcm = ImageChops.multiply(srcm, ImageOps.invert(grow_mask(hole, 4)))
    if lum_max < 255:
        srcm = ImageChops.multiply(srcm, img.convert('L').point(lambda v: 255 if v <= lum_max else 0))
    if no_red:
        r, g, b = img.convert('RGB').split()
        srcm = ImageChops.multiply(srcm, ImageChops.subtract(r, g).point(lambda v: 0 if v > 25 else 255))
    srcm = shrink_mask(grow_mask(srcm, 2), 3)                  # drop isolated pixels
    fill = quilt_fill(img, hole, srcm, patch=int(patch_deg * px_deg), seed=seed, flip=True, min_cover=0.9)
    return blend_fill(img, fill, hole, 6), hole


def continue_down(img, valid, P, band_deg=2.5, blur=14):
    """Below the photo: the average colour of the bottom band continues downward, smoothed sideways (this part
    is only seen at steep angles). Returns (img, mask of the filled area)."""
    px_deg = P.w / (P.az1 - P.az0)
    bh = int(band_deg * px_deg)
    layer = img.copy()
    below = Image.new('L', P.size, 0)
    for x in range(P.w):
        bb = valid.crop((x, 0, x + 1, P.h)).getbbox()
        if not bb or bb[3] >= P.h:
            continue
        y = bb[3] - 3
        c = img.crop((x, max(0, y - bh), x + 1, y)).resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
        layer.paste(c, (x, y, x + 1, P.h))
        below.paste(255, (x, y, x + 1, P.h))
    layer = layer.filter(ImageFilter.BoxBlur(blur)).filter(ImageFilter.GaussianBlur(blur / 2))
    return Image.composite(layer, img, below.filter(ImageFilter.GaussianBlur(3))), below


def build_ost(sky_color):
    """View through the kitchen windows: the dark annex wall close on the left (east), the terrace railing
    (removed: built in 3D), the river with the red boathouses and the houses climbing the far bank."""
    P = Pano(*OST_PANO)
    f = FRAME_950
    cam = solve_lines([(f['top'], (0, 0, 1)), (f['bottom'], (0, 0, 1)), (f['left'], (0, 1, 0))],
                      [(FAR_SHORE_950, 0.1)], guess=(0, -14, 0))
    # the frame lines are nearly parallel (weak vanishing point): yaw from the skyline matched to sor.jpg,
    # plus the parallax of the ~400 m distant hills seen from ~8 m further east
    cam = (cam[0] + OST_YAW_FIX, cam[1], cam[2])
    removals = [([[(2930, 960), (3420, 960), (3420, 1560), (2930, 1560)]],      # pampas grass + vase
                 [[(22, 4), (30, 4), (30, -4.6), (22, -4.6)]])]

    def below(img, valid, P):
        # the annex wall continues down and to the left (east); it stands in front in 3D anyway
        img, h1 = quilt_region(img, valid, P, ANNEX_HOLE, ANNEX_WALL, 1.6, 41)
        # the railing, the chair and the table give way to a green slope (seen between the 3D railing slats)
        img, h2 = quilt_region(img, valid, P, OST_SLOPE_HOLE, OST_SLOPE_SRC, 2.0, 42, lum_max=170, no_red=True)
        return img, ImageChops.lighter(valid, ImageChops.lighter(h1, h2))

    img, valid, cam = build_window_view('082950', f, cam, P, removals=removals, sky_color=sky_color,
                                        below=below, extend=())
    img, m_r = stretch_extend(img, P, 11.0, -33, 'right', OST_COVER_R, k=2.0)
    valid = ImageChops.lighter(valid, m_r.point(lambda v: 255 if v else 0))
    S = render_sky(sky_color, P)
    img = Image.composite(img, S, shrink_mask(valid, 2).filter(ImageFilter.GaussianBlur(1.5)))
    debug_save(img, 'ost-final.jpg')
    return img, P, cam


def build_nord(sky_color):
    """View through the strip window in the TV room (north): birch leaves, the light grey-blue commercial
    building with a flat roof and a mesh fence, a small spruce and the forested knoll."""
    P = Pano(*NORD_PANO)
    f = FRAME_800
    cam = solve_lines([(f['top'], (0, 0, 1)), (f['bottom'], (0, 0, 1)), (f['left'], (0, 1, 0)), (f['right'], (0, 1, 0))],
                      guess=(163, -2, 0))
    ground = [[(150, 3.5), (200, 3.5), (200, -1.4), (150, -1.4)]]
    removals = [
        ([[(1290, 1410), (1590, 1410), (1590, 1625), (1290, 1625)]], ground),      # books + glass vase
        ([[(1925, 1360), (2135, 1360), (2135, 1625), (1925, 1625)]], ground),      # vases with eucalyptus
        ([[(2470, 1490), (2905, 1490), (2905, 1630), (2470, 1630)]], ground),      # felt basket
    ]
    img, valid, cam = build_window_view('082800', f, cam, P, removals=removals, sky_color=None, grade=(1.0, 1.0),
                                        inset=24)
    l_az, r_az = coverage_az(valid, P, 2.0)
    cover = (l_az + 0.8, r_az - 0.8)              # azimuth range covered by the strip window
    # sky colour as photographed just above the building (bright, hazy), deepening upward like the south sky
    probe = ImageChops.multiply(pano_poly_mask(P, [[(158, 9.5), (170, 9.5), (170, 6.5), (158, 6.5)]]), valid)
    probe = ImageChops.multiply(probe, img.convert('L').point(lambda v: 255 if v > 200 else 0))
    base = ImageStat.Stat(img, probe).mean if ImageStat.Stat(probe).sum[0] else [228, 234, 236]

    def north_sky(az, e):
        t = min(1.0, max(0.0, (e - 8.0) / 30.0))
        t = t * t * (3 - 2 * t)
        top = sky_color(-20.0, 30.0) if sky_color else (150, 175, 200)
        return tuple(int(base[k] * (1 - t) + top[k] * t) for k in range(3))

    S = render_sky(north_sky, P)
    # below the sill: blurred continuation (hardly ever visible: the sill is at 1.64 m)
    img, low = continue_down(img, valid, P, blur=14)
    cov = ImageChops.lighter(valid, ImageChops.multiply(low, pano_poly_mask(
        P, [[(cover[0], 2), (cover[1], 2), (cover[1], -20), (cover[0], -20)]])))
    # sides: stretched continuation of the rows the photo covers
    tops = column_tops(valid)
    top_at = lambda az: P.e_of(tops[int(P.x_of(az))]) - 1.0      # below the hazy rim under the window head
    img, m_l = stretch_extend(img, P, top_at(cover[0] + 1.0), -16, 'left', cover[0] + 0.5, k=2.0)
    img, m_r = stretch_extend(img, P, top_at(cover[1] - 1.0), -16, 'right', cover[1] - 0.5, k=2.0)
    cov = ImageChops.lighter(cov, ImageChops.lighter(m_l, m_r).point(lambda v: 255 if v else 0))
    # crowns (birch, left) and the knoll (right) cut by the window head continue upward: the band below the
    # cut is copied up by a height profile (a rounded knoll, a birch crown), then given a ragged outline
    tops = column_tops(cov)
    smooth = lambda t: 0.0 if t <= 0 else 1.0 if t >= 1 else t * t * (3 - 2 * t)

    def profile(az):
        birch = 3.5 * smooth((az - 133) / 6.0) * (1 - smooth((az - 156) / 5.0))
        knoll = 5.0 * smooth((az - 178) / 9.0) * (1 - smooth((az - 212) / 18.0))
        return max(birch, knoll)

    up = img.copy()
    m_up = Image.new('L', P.size, 0)
    px_deg = P.w / (P.az1 - P.az0)
    band = int(2.6 * px_deg)       # source: the top 2.6° under the cut (above the street lights), stretched
    for x in range(P.w):
        hgt = int(profile(P.az_of(x)) * px_deg)
        yc = tops[x] + 10         # the rows right under the window head are hazy: they are replaced too
        if hgt < 2 or yc - hgt < 0 or yc + band > P.h:
            continue
        col = img.crop((x, yc, x + 1, yc + band)).resize((1, hgt + 10), BICUBIC)
        up.paste(col, (x, yc - hgt))
        m_up.paste(255, (x, yc - hgt, x + 1, yc + 10))
    obj_up = ImageChops.multiply(shrink_mask(not_sky_mask(up), 2), m_up)
    img = Image.composite(up, img, obj_up.filter(ImageFilter.GaussianBlur(0.8)))
    cov = ImageChops.lighter(cov, obj_up)
    img = Image.composite(img, S, shrink_mask(cov, 1).filter(ImageFilter.GaussianBlur(1.2)))
    img = ragged_top(img, S, cov, ImageChops.lighter(not_sky_mask(img), obj_up), P, depth_deg=1.8, seed=43)
    # the overexposed (white) sky of the photo above the roof line -> the sky model (soft, by brightness)
    lum = img.convert('L')
    white = lum.point(lambda v: 0 if v < 226 else min(255, (v - 226) * 16))
    white = ImageChops.multiply(white, img.convert('HSV').getchannel(1).point(lambda v: 255 if v < 40 else 0))
    white = ImageChops.multiply(white, smoothstep_rows(P, 4.6, 6.0)).filter(ImageFilter.GaussianBlur(1.0))
    img = Image.composite(S, img, white)
    img = ImageEnhance.Contrast(img).enhance(1.06)
    img = ImageEnhance.Color(img).enhance(1.05)
    debug_save(img, 'nord-final.jpg')
    return img, P, cam


# (azimuth/elevation in the ost panorama with the camera above)
ANNEX_HOLE = [[(-61, 16), (-18.0, 16), (-18.0, -10.4), (-12.0, -10.4), (-12.0, -40), (-61, -40)]]
ANNEX_WALL = [[(-17.8, -4.0), (-15.4, -4.0), (-15.4, -10.2), (-17.8, -10.2)]]
OST_SLOPE_HOLE = [[(-15.0, -5.7), (0, -5.5), (40, -5.3), (40, -40), (-12.0, -40), (-12.0, -10.4), (-15.0, -10.4)]]
OST_SLOPE_SRC = [[(-1, -1.0), (8, -1.0), (8, -5.0), (-1, -5.0)], [(12, 0), (30, 0), (30, -5.0), (12, -5.0)]]
OST_COVER_R = 34.0
FAR_SHORE_950 = (1950, 1069)     # far waterline below the boathouses in 082950 (elevation ~0.1° as in sor.jpg)
OST_YAW_FIX = 1.5


# ----------------------------------------------------------------------------------------------------------
# 3d. Blue hour (sor-kveld.jpg)
# ----------------------------------------------------------------------------------------------------------

def blue_hour_sky(az, e):
    """Clear October blue hour at 58° N, ~30 min after sunset (the sun set at azimuth ≈ +70°, south toward
    west): deep blue overhead, paler near the horizon, a faint warm glow low in the south-west."""
    e = max(e, -2.0)
    stops = [(-2, (104, 112, 150)), (0, (118, 124, 160)), (4, (96, 108, 152)), (10, (72, 90, 140)),
             (20, (50, 70, 122)), (32, (36, 54, 104)), (45, (28, 42, 88))]
    for (e0, c0), (e1, c1) in zip(stops, stops[1:]):
        if e <= e1:
            t = (e - e0) / (e1 - e0)
            c = [c0[k] + (c1[k] - c0[k]) * t for k in range(3)]
            break
    else:
        c = list(stops[-1][1])
    glow = math.exp(-((az - 68.0) / 30.0) ** 2) * math.exp(-max(e, 0.0) / 6.0)
    warm = (78, 34, -6)
    return tuple(max(0, min(255, int(c[k] + warm[k] * glow))) for k in range(3))


def build_kveld(day, P, seed=51):
    """Evening version of the south view: the photographed sky is swapped for a blue-hour sky, the landscape
    darkened and cooled, the river reflects the evening sky, a few windows in the village are lit."""
    import random
    rnd = random.Random(seed)
    rgb = day.convert('RGB')
    S_day, _ = sky_model(rgb, sky_mask(rgb, P, e_min=8), P)       # refit: the day image is colour-graded
    # sky alpha: where the day image is (still) the smooth sky model
    d = ImageChops.difference(rgb, S_day).convert('L')
    sky_a = d.point(lambda v: 255 if v < 8 else (0 if v > 26 else int(255 * (26 - v) / 18)))
    sky_a = ImageChops.multiply(sky_a, smoothstep_rows(P, -1.0, 1.5)).filter(ImageFilter.GaussianBlur(1.2))
    S_eve = render_sky(blue_hour_sky, P)
    # land: darker, cooler, less saturated
    land = ImageEnhance.Color(rgb).enhance(0.55)
    lut = [int(255 * (v / 255.0) ** 1.35 * 0.30) for v in range(256)]
    r, g, b = land.split()
    land = Image.merge('RGB', [r.point([int(x * 0.78) for x in lut]), g.point([int(x * 0.88) for x in lut]),
                               b.point([min(255, int(x * 1.18)) for x in lut])])
    ambient = S_eve.filter(ImageFilter.GaussianBlur(40))
    land = ImageChops.add(land, ImageEnhance.Brightness(ambient).enhance(0.10))
    # the river: bright, grey/blue water in the day picture -> mirror of the evening sky near the horizon
    hsv_s = rgb.convert('HSV').getchannel(1)
    lum = rgb.convert('L')
    water = ImageChops.multiply(lum.point(lambda v: 255 if v > 172 else 0), hsv_s.point(lambda v: 255 if v < 60 else 0))
    water = ImageChops.multiply(water, pano_poly_mask(P, [[(-45, 0.2), (30, 0.2), (30, -8.5), (-45, -8.5)]]))
    water = ImageChops.multiply(water, ImageOps.invert(sky_a))
    water = water.filter(ImageFilter.GaussianBlur(1.5))
    refl = ImageEnhance.Brightness(render_sky(lambda az, e: blue_hour_sky(az, -e * 0.6 + 1.0), P)).enhance(0.72)
    # keep the ripples / reflections of the day picture as luminance detail
    detail = ImageChops.subtract(lum, lum.filter(ImageFilter.GaussianBlur(6)), scale=1.0, offset=128)
    refl = ImageChops.add(refl, Image.merge('RGB', [detail] * 3), scale=1.0, offset=-128)
    land = Image.composite(refl, land, water)
    out = Image.composite(S_eve, land, sky_a)
    # lit windows in the white houses across the river and a couple at the boathouses
    lamps = Image.new('RGB', P.size, (0, 0, 0))
    dl = ImageDraw.Draw(lamps)
    lumf = pixels(lum)
    notsky = pixels(grow_mask(sky_a.point(lambda v: 255 if v > 40 else 0), 4))
    cands = []
    for az0, az1, e0, e1 in VILLAGE_BOXES:
        x0, x1 = int(P.x_of(az0)), int(P.x_of(az1))
        y0, y1 = int(P.y_of_e(e1)), int(P.y_of_e(e0))
        for y in range(y0, y1, 2):
            for x in range(x0, x1, 2):
                if lumf[y * P.w + x] > 205 and notsky[y * P.w + x] < 128:
                    cands.append((x, y))
    rnd.shuffle(cands)
    placed = []
    for x, y in cands:
        if len(placed) >= 46:
            break
        if any(abs(x - px) < 9 and abs(y - py) < 6 for px, py in placed):
            continue
        placed.append((x, y))
        w = rnd.choice((2, 2, 3))
        warmth = rnd.choice(((255, 200, 128), (255, 214, 150), (255, 186, 110), (250, 226, 190)))
        dl.rectangle([x, y, x + w - 1, y + 1], fill=warmth)
    glow = lamps.filter(ImageFilter.GaussianBlur(3))
    out = ImageChops.add(out, ImageEnhance.Brightness(glow).enhance(2.2))
    out = ImageChops.lighter(out, lamps)
    log('  kveld: %d lit windows' % len(placed))
    return out


# White houses across the river (azimuth, elevation boxes in sor.jpg) – where evening lights may appear.
VILLAGE_BOXES = [(-14.0, -3.0, -0.3, 1.6), (-3.0, 14.0, -0.3, 5.5)]


# ----------------------------------------------------------------------------------------------------------
# 3e. Write the backdrops and backdrops.json
# ----------------------------------------------------------------------------------------------------------

# Photo camera positions (world metres), solved from the window frames: the frame edges subtend known widths
# (room-spec openings) and the glass plane lies ~0.13 m outside the inner wall face.
CENTER_SOR = [6.10, 1.65, 10.45]      # 082850/52/55: ~0.95 m inside the west living-room window (win-s2)
CENTER_OST = [4.27, 1.56, 1.41]       # 082950: by the kitchen island, ~2.05 m from win-k1
CENTER_NORD = [1.66, 1.82, 9.71]      # 082800: TV room, ~1.70 m from the strip window win-tv


def pano_meta(P):
    return {
        'projection': 'cylinder',
        'azimuthDeg': [P.az0, P.az1],
        'elevationDeg': [round(math.degrees(math.atan(P.t0)), 2), round(math.degrees(math.atan(P.t1)), 2)],
        'tanElevation': [P.t0, P.t1],
        'horizonV': round(-P.t0 / (P.t1 - P.t0), 4),
    }


def cylinder_dims(P, radius):
    return {
        'suggestedDistance': radius,
        'suggestedWidth': round(radius * math.radians(P.az1 - P.az0), 1),
        'suggestedHeight': round(radius * (P.t1 - P.t0), 1),
    }


def save_backdrop(img, name, quality=85, low_width=2048):
    d = os.path.join(OUT, 'utsikt')
    path = os.path.join(d, name + '.jpg')
    save_jpeg(img, path, quality)
    low = img.resize((low_width, round(img.height * low_width / img.width)), RESAMPLE) if img.width > low_width \
        else img.resize((img.width // 2, img.height // 2), RESAMPLE)
    lpath = os.path.join(d, 'lav', name + '.jpg')
    save_jpeg(low, lpath, 82)
    return [path, lpath], low.size


def prep_utsikt():
    if REALIGN:
        align_photos()
    out = []
    sor, P, sky_color = build_sor()
    # the far left (behind the annex) has only the stretched continuation; nothing else to do here
    files, low_s = save_backdrop(sor, 'sor')
    out += files
    kveld = build_kveld(sor, P)
    debug_save(kveld, 'sor-kveld.jpg')
    files, _ = save_backdrop(kveld, 'sor-kveld')
    out += files
    ost, Po, cam_o = build_ost(sky_color)
    files, low_o = save_backdrop(ost, 'ost')
    out += files
    nord, Pn, cam_n = build_nord(sky_color)
    files, low_n = save_backdrop(nord, 'nord')
    out += files

    conv = ('Cylinder around a vertical axis through "center" (world metres, +x south, +y up, +z west). Image column '
            'u (0 = left edge) maps linearly to azimuth: az = azimuthDeg[0] + u * (azimuthDeg[1] - azimuthDeg[0]); '
            'azimuth is measured from +x (south) toward +z (west), so a texel at azimuth az lies in world direction '
            '(cos az, 0, sin az). Image row v (0 = bottom) maps linearly to height on the cylinder: '
            'y = center.y + radius * (tanElevation[0] + v * (tanElevation[1] - tanElevation[0])); horizonV is the '
            'row of the camera horizon (eye height = center.y). Seen from "center" the image is an exact '
            'reprojection of the photos (verified by rendering it back to the photo cameras). center = the '
            'photo camera position (from the window frame in the photo). suggestedWidth/Height = arc length and '
            'height of the cylinder segment at radius suggestedDistance; any radius gives the same picture from '
            'center, the radius only sets the parallax when the viewer moves (≈ distance of the main subject).')
    data = {
        'version': 1,
        'generatedBy': 'tools/prep-images.py',
        'mapping': conv,
        'backdrops': [
            dict(id='sor', file='img/utsikt/sor.jpg', fileLow='img/utsikt/lav/sor.jpg', size=list(sor.size),
                 facing='south', windows=['win-s1', 'win-s2', 'door-terrasse'], **pano_meta(P),
                 center=CENTER_SOR, **cylinder_dims(P, 60),
                 sourcePhotos=['20261018_082850.jpg', '20261018_082852.jpg', '20261018_082855.jpg'],
                 cameraRotations={k: list(CAMS[k]) for k in ('082850', '082852', '082855')},
                 timeOfDay='morning, clear (08:28, 18 Oct)',
                 notes=('Living-room view south over the lawn to the river (~60 m), the red boathouses (~150 m, '
                        'az -12..-4), the houses on the far bank (az 0..+14) and the hills (1-2 km). Shot through '
                        'the west living-room window; window frames, the lamp reflections and the terrace '
                        '(deck, railing, stair, concrete landing: build them in 3D) are removed. The big lichen '
                        'rock (3-5 m, az +7..+27) and the trees west of the house (az +15..+66) are close: they '
                        'only line up from near "center". Keep 3D ground within a few metres of the facade '
                        '(terrace, a strip of lawn) – the photo itself shows the lawn falling ~2.7 m below the floor '
                        'down to the river; a ground plane further out would cover it. Beyond az -66 (east, '
                        'behind the annex) and +66 (west, only seen at grazing angles) the photos are continued '
                        'by a stretched, softened reflection. Use an unlit material (MeshBasicMaterial, '
                        'colorSpace SRGB, toneMapped false, fog false) and scale its colour with daylight.')),
            dict(id='sor-kveld', file='img/utsikt/sor-kveld.jpg', fileLow='img/utsikt/lav/sor-kveld.jpg',
                 size=list(kveld.size), facing='south', windows=['win-s1', 'win-s2', 'door-terrasse'],
                 **pano_meta(P), center=CENTER_SOR,
                 **cylinder_dims(P, 60), timeOfDay='blue hour, ~30 min after sunset',
                 notes=('Same geometry as sor.jpg (swap the map or cross-fade). Deep-blue sky with a faint glow '
                        'low in the south-west (az +40..+90), darkened landscape, the river mirroring the evening '
                        'sky and a few lit windows in the houses across the river. For night, darken it '
                        'further (colour x 0.15-0.3).')),
            dict(id='ost', file='img/utsikt/ost.jpg', fileLow='img/utsikt/lav/ost.jpg', size=list(ost.size),
                 facing='south', role='kitchen', windows=['win-k1', 'win-k2'], **pano_meta(Po),
                 center=CENTER_OST, **cylinder_dims(Po, 40),
                 sourcePhotos=['20261018_082950.jpg'], cameraRotations={'082950': list(cam_o)},
                 notes=('Kitchen-end view ("ost" = the east end of the room): what the long kitchen window '
                        '(win-k1, wall x = 6.32) sees from the kitchen island. NB the kitchen windows face SOUTH '
                        '(like the living room), not east, so facing is "south" and the azimuths are absolute: the '
                        '"east" part is the dark wooden annex/outbuilding that closes the terrace to the east and '
                        'fills the left of the view (az < -15, its gable edge runs from az -18/e +13 down to '
                        'az -12/e -3). Then the river with the red boathouses and the houses climbing the far '
                        'bank (az +10..+40). The terrace railing, chair and table are removed (build them in 3D); '
                        'below the railing top (e < -5.5) there is a soft green slope only meant to be seen '
                        'between the slats. Sky = the same sky model as sor.jpg (same directions), so the two '
                        'match where they meet. Optional: sor.jpg alone also works for the kitchen windows (it '
                        'is the same landscape seen 8 m further west); use ost.jpg if you give the kitchen its own '
                        'backdrop layer or for a kitchen photo comparison.')),
            dict(id='nord', file='img/utsikt/nord.jpg', fileLow='img/utsikt/lav/nord.jpg', size=list(nord.size),
                 facing='north', windows=['win-tv'], **pano_meta(Pn), center=CENTER_NORD, **cylinder_dims(Pn, 25),
                 sourcePhotos=['20261018_082800.jpg'], cameraRotations={'082800': list(cam_n)},
                 notes=('TV-room strip window (win-tv, wall x = 0, sill 1.64 m): yellow birch leaves close to the '
                        'glass (left, az 135..160), the light grey-blue commercial building with a flat roof and a '
                        'mesh fence (~20-30 m), a small spruce, and the forested knoll behind (right). Objects on '
                        'the sill are removed. Above the photo the knoll/crowns are continued with a rounded '
                        'top; below the sill only a blurred fill (hardly visible: the glass starts at 1.70 m). '
                        'The sky is the photographed hazy north sky deepening upward.')),
        ],
    }
    jp = os.path.join(OUT, 'utsikt', 'backdrops.json')
    with open(jp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    out.append(jp)
    return out


# ----------------------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------------------

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')] or ['all']
    t0 = time.time()
    written = []
    if 'all' in args or 'forslag' in args:
        written += prep_forslag()
    if 'all' in args or 'foto' in args:
        written += prep_foto()
    if 'all' in args or 'stue' in args:
        written += prep_stue()
    if 'all' in args or 'utsikt' in args:
        written += prep_utsikt()
    log('')
    total = 0
    for p in written:
        sz = os.path.getsize(p)
        total += sz
        try:
            dims = '%dx%d' % Image.open(p).size if not p.endswith('.json') else ''
        except Exception:
            dims = ''
        log('  %-44s %9s  %7.1f kB' % (rel(p), dims, sz / 1024))
    log('%d files, %.1f MB, %.0f s' % (len(written), total / 1048576, time.time() - t0))


if __name__ == '__main__':
    main()
