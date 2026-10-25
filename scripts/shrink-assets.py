# Recompress downloaded asset JPG/PNGs so public/assets stays within the 60 MB budget.
# Colour maps: quality 78 (model colour maps max 1024 px). Normal/roughness/ARM detail maps: max 512 px, quality 75.
import sys, os
from PIL import Image

root = sys.argv[1] if len(sys.argv) > 1 else 'public/assets'
# Re-running must not recompress (and degrade) files already processed.
stamp = os.path.join(root, '.shrunk')
done = set(open(stamp).read().splitlines()) if os.path.exists(stamp) else set()
for d, _, files in os.walk(root):
    for f in files:
        p = os.path.join(d, f)
        ext = f.lower().rsplit('.', 1)[-1]
        if ext not in ('jpg', 'jpeg', 'png') or p in done:
            continue
        im = Image.open(p)
        colour = f.startswith('diff') or 'diff' in f.lower()
        in_models = 'models' in p.replace(os.sep, '/').split('/')
        limit = (1024 if in_models else max(im.size)) if colour else 512
        if max(im.size) > limit:
            im.thumbnail((limit, limit), Image.LANCZOS)
        if ext == 'png':
            im.save(p, optimize=True)
        else:
            im.convert('RGB').save(p, quality=78 if colour else 75, optimize=True, progressive=True)
        done.add(p)
open(stamp, 'w').write(chr(10).join(sorted(done)))
print('ok')
