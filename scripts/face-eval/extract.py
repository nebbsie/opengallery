"""
Extract face embeddings for evaluate.py. Run INSIDE the opengallery container
(it uses the face-service venv, /data/opengallery.db and the originals):

  docker cp scripts/face-eval/extract.py opengallery:/tmp/extract.py
  docker exec opengallery nice -n 15 /opt/venv/bin/python /tmp/extract.py 60
  docker cp opengallery:/tmp/og_calib/emb.json .
  python3 evaluate.py emb.json

Samples up to N faces per named person plus 800 unnamed faces, re-detects
each in its original photo, and stores three embeddings per face (see
evaluate.py). Read-only on the DB and the originals; writes only under
/tmp/og_calib (it downloads antelopev2 there for the comparison).
"""
import os, sys, json, sqlite3, random, time, urllib.request, zipfile
import numpy as np, cv2
from insightface.app import FaceAnalysis
from insightface.model_zoo import get_model
from insightface.utils import face_align
OUT='/tmp/og_calib'; os.makedirs(OUT,exist_ok=True)
ante=f'{OUT}/models/antelopev2'
if not os.path.exists(f'{ante}/glintr100.onnx'):
    os.makedirs(ante,exist_ok=True)
    z=f'{OUT}/antelopev2.zip'
    urllib.request.urlretrieve('https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip',z)
    with zipfile.ZipFile(z) as zz:
        for n in zz.namelist():
            if n.endswith('.onnx'):
                open(f'{ante}/{os.path.basename(n)}','wb').write(zz.read(n))
print('models',os.listdir(ante),flush=True)
con=sqlite3.connect('file:/data/opengallery.db?mode=ro',uri=True)
rows=con.execute("""select fa.id,fa.box_x,fa.box_y,fa.box_w,fa.box_h,f.dir,f.name,p.name,fa.file_id from face fa join person p on p.id=fa.person_id join file f on f.id=fa.file_id
 where p.name is not null""").fetchall()
random.seed(1)
byp={}
for r in rows: byp.setdefault(r[7],[]).append(r)
sample=[]
for n,l in byp.items(): random.shuffle(l); sample+=l[:int(sys.argv[1]) if len(sys.argv)>1 else 60]
unn=con.execute("select fa.id,fa.box_x,fa.box_y,fa.box_w,fa.box_h,f.dir,f.name,null,fa.file_id from face fa join person p on p.id=fa.person_id join file f on f.id=fa.file_id where p.name is null order by random() limit 800").fetchall()
sample+=unn
print('sample',len(sample),flush=True)
det=FaceAnalysis(name='buffalo_l',root='/opt/insightface',allowed_modules=['detection'],providers=['CPUExecutionProvider']); det.prepare(ctx_id=-1,det_size=(1024,1024))
r50=get_model('/opt/insightface/models/buffalo_l/w600k_r50.onnx',providers=['CPUExecutionProvider']); r50.prepare(ctx_id=-1)
g100=get_model(f'{ante}/glintr100.onnx',providers=['CPUExecutionProvider']); g100.prepare(ctx_id=-1)
def iou(a,b):
    x1=max(a[0],b[0]);y1=max(a[1],b[1]);x2=min(a[2],b[2]);y2=min(a[3],b[3])
    i=max(0,x2-x1)*max(0,y2-y1); u=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i
    return i/u if u>0 else 0
res=[]; t0=time.time()
byfile={}
for r in sample: byfile.setdefault((r[5],r[6]),[]).append(r)
for k,(path,items) in enumerate(byfile.items()):
    img=cv2.imread(os.path.join(*path),cv2.IMREAD_COLOR)
    if img is None: continue
    H,W=img.shape[:2]; s=min(1.0,1024/max(H,W))
    small=cv2.resize(img,(int(W*s),int(H*s)),interpolation=cv2.INTER_AREA) if s<1 else img
    faces=det.get(small)
    for r in items:
        box=[r[1]*small.shape[1],r[2]*small.shape[0],(r[1]+r[3])*small.shape[1],(r[2]+r[4])*small.shape[0]]
        best=max(faces,key=lambda f:iou(f.bbox,box),default=None)
        if best is None or iou(best.bbox,box)<0.4: continue
        kps_s=best.kps; kps_full=kps_s/s
        a_small=face_align.norm_crop(small,kps_s); a_full=face_align.norm_crop(img,kps_full)
        e1=r50.get_feat(a_small).flatten(); e2=r50.get_feat(a_full).flatten(); e3=g100.get_feat(a_full).flatten()
        g=cv2.cvtColor(a_full,cv2.COLOR_BGR2GRAY); blur=float(cv2.Laplacian(g,cv2.CV_64F).var())
        ed=np.linalg.norm(kps_full[0]-kps_full[1]); mid=(kps_full[0]+kps_full[1])/2
        yaw=float((kps_full[2][0]-mid[0])/max(ed,1e-6))
        res.append(dict(id=r[0],file=r[8],name=r[7],det=float(best.det_score),facepx=float((best.bbox[3]-best.bbox[1])/s),blur=blur,yaw=yaw,
            n1=float(np.linalg.norm(e1)),n2=float(np.linalg.norm(e2)),n3=float(np.linalg.norm(e3)),
            e1=(e1/np.linalg.norm(e1)).astype(np.float32).tolist(),e2=(e2/np.linalg.norm(e2)).astype(np.float32).tolist(),e3=(e3/np.linalg.norm(e3)).astype(np.float32).tolist()))
    if k%100==0: print(k,len(byfile),len(res),round(time.time()-t0),flush=True)
json.dump(res,open(f'{OUT}/emb.json','w'))
print('done',len(res),round(time.time()-t0),flush=True)
