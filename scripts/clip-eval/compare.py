"""
Compare image-text (CLIP-style) models for object search on a real library.
Run INSIDE the opengallery container (face-service venv). Read-only on the DB
and the originals; writes only under /tmp/og_clip.

  python compare.py 3000

Downloads Immich's ONNX exports from Hugging Face, embeds N random photos with
each model, times it, runs a list of text queries, and writes a contact sheet
per model (top 8 per query) to /tmp/og_clip/sheet_<model>.jpg for review.
"""
import json, os, random, sqlite3, sys, time, urllib.request
OUT = "/tmp/og_clip"; os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, f"{OUT}/pylib")
import numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw, ImageOps
from tokenizers import Tokenizer

MODELS = {
    "siglip2": ("ViT-B-16-SigLIP2__webli", 64),
    "clip-b32": ("ViT-B-32__openai", 77),
}
FILES = ["config.json", "visual/model.onnx", "visual/preprocess_cfg.json", "textual/model.onnx", "textual/tokenizer.json"]
QUERIES = ["car", "red car", "teapot", "dog", "cat", "beach", "birthday cake", "football match",
           "christmas tree", "snow", "wedding dress", "aeroplane", "swimming pool", "baby", "pizza", "sunset"]

def fetch(repo):
    d = f"{OUT}/models/{repo}"
    for f in FILES:
        p = f"{d}/{f}"
        if not os.path.exists(p):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            urllib.request.urlretrieve(f"https://huggingface.co/immich-app/{repo}/resolve/main/{f}", p)
    return d

def canonicalize(t):
    import string
    t = t.lower().translate(str.maketrans("", "", string.punctuation))
    return " ".join(t.split())

def load(name):
    repo, ctx = MODELS[name]
    d = fetch(repo)
    so = ort.SessionOptions(); so.intra_op_num_threads = 8
    vis = ort.InferenceSession(f"{d}/visual/model.onnx", so, providers=["CPUExecutionProvider"])
    txt = ort.InferenceSession(f"{d}/textual/model.onnx", so, providers=["CPUExecutionProvider"])
    cfg = json.load(open(f"{d}/visual/preprocess_cfg.json"))
    tok = Tokenizer.from_file(f"{d}/textual/tokenizer.json")
    pad = tok.token_to_id("<pad>") if name == "siglip2" else 0
    tok.enable_padding(length=ctx, pad_id=pad if pad is not None else 0)
    tok.enable_truncation(ctx)
    return vis, txt, cfg, tok, name

def prep(img, cfg):
    s = cfg["size"][0]
    img = img.convert("RGB")
    if cfg["resize_mode"] == "squash":
        img = img.resize((s, s), Image.BICUBIC)
    else:
        img = ImageOps.fit(img, (s, s), Image.BICUBIC)
    a = (np.asarray(img, np.float32) / 255.0 - np.array(cfg["mean"], np.float32)) / np.array(cfg["std"], np.float32)
    return a.transpose(2, 0, 1)[None]

def norm(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)

def embed_text(m, q):
    vis, txt, cfg, tok, name = m
    text = canonicalize(q) if name == "siglip2" else q
    ids = np.array([tok.encode(text).ids], dtype=np.int32)
    inp = txt.get_inputs()[0]
    if "int64" in inp.type: ids = ids.astype(np.int64)
    return norm(txt.run(None, {inp.name: ids})[0][0])

con = sqlite3.connect("file:/data/opengallery.db?mode=ro", uri=True)
rows = con.execute("""select f.id, f.dir||'/'||f.name from file f join library_file lf on lf.file_id=f.id
  where f.type='image' and lf.deleted_at is null and lower(f.name) like '%.jp%g'""").fetchall()
random.seed(3); random.shuffle(rows); rows = rows[:int(sys.argv[1]) if len(sys.argv) > 1 else 3000]

imgs = []
t0 = time.time()
for fid, p in rows:
    try:
        im = Image.open(p); im.draft("RGB", (448, 448)); im = ImageOps.exif_transpose(im); im.load()
        imgs.append((fid, p, im.copy()))
    except Exception:
        pass
print("decoded", len(imgs), round(time.time() - t0), "s", flush=True)

for name in MODELS:
    m = load(name)
    vis, _, cfg, _, _ = m
    inp = vis.get_inputs()[0].name
    t0 = time.time(); E = []
    # The exports take one image per call (batch dimension fixed at 1).
    for _, _, im in imgs:
        E.append(vis.run(None, {inp: prep(im, cfg)})[0])
    E = norm(np.concatenate(E)); dt = time.time() - t0
    print(f"{name}: {len(imgs)} images in {dt:.0f}s = {1000*dt/len(imgs):.0f} ms/image, dim {E.shape[1]}", flush=True)
    res = {}
    W, H, T = 8, len(QUERIES), 120
    sheet = Image.new("RGB", (160 + W * T, H * T), "white"); dr = ImageDraw.Draw(sheet)
    for qi, q in enumerate(QUERIES):
        s = E @ embed_text(m, q); top = np.argsort(-s)[:W]
        res[q] = [(imgs[j][0], float(s[j])) for j in top]
        dr.text((6, qi * T + 50), q, fill="black")
        for k, j in enumerate(top):
            th = ImageOps.fit(imgs[j][2], (T - 4, T - 4)); sheet.paste(th, (160 + k * T, qi * T + 2))
    sheet.save(f"{OUT}/sheet_{name}.jpg", quality=80)
    json.dump(res, open(f"{OUT}/top_{name}.json", "w"))
print("done", flush=True)
