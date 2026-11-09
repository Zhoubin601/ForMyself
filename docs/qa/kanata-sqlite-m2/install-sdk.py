"""M2 fresh Linux SDK preparation only, no production files.
Read README first. Download official XML metadata to work/m2 before invoking.
Extract images sparsely after exact official size/SHA1 verification plus ZIP CRC.
Never overwrites an existing installation. Not an Android integration test.
"""
from pathlib import Path
from urllib.request import urlopen
import xml.etree.ElementTree as E,zipfile,hashlib,os
root=Path('work/m2/android-sdk')
if root.exists() and any(p.name != 'platform-tools' for p in root.iterdir()):
 raise SystemExit('Refuse to overwrite an existing SDK; use a fresh work/m2 directory.')
root.mkdir(exist_ok=True)
items=[]
for file,ids,base in [('work/m2/android-repository.xml',['emulator','platforms;android-36','build-tools;35.0.0','build-tools;36.0.0'],'https://dl.google.com/android/repository/'),('work/m2/atd-images.xml',['system-images;android-34;aosp_atd;x86_64'],'https://dl.google.com/android/repository/sys-img/aosp_atd/')]:
 tree=E.parse(file).getroot()
 for ident in ids:
  packages=[p for p in tree if p.attrib.get('path')==ident]
  p=packages[-1] if ident in ['emulator','platforms;android-36'] else packages[0]
  archive=next(a for a in p.findall('archives/archive') if a.findtext('host-os') in (None,'linux'))
  items.append((ident,p,archive,base))
for ident,p,a,base in items:
 name=a.findtext('complete/url');target=Path('work/m2')/name
 if not target.exists():
  print('download',name,flush=True)
  with urlopen(base+name,timeout=120) as src,target.open('xb') as dst:
   for chunk in iter(lambda:src.read(1024*1024),b''):dst.write(chunk)
 assert target.stat().st_size==int(a.findtext('complete/size'))
 assert hashlib.sha1(target.read_bytes()).hexdigest()==a.findtext('complete/checksum')
 dest=root/ident.replace(';','/') if ident.startswith('system-images;') else root/('platforms/android-36' if ident.startswith('platforms;') else 'build-tools/'+ident.split(';')[1] if ident.startswith('build-tools;') else '')
 with zipfile.ZipFile(target) as z:
  for info in z.infolist():
   parts=Path(info.filename).parts
   assert not Path(info.filename).is_absolute() and '..' not in parts
   assert (info.external_attr>>16)&0o170000 != 0o120000
   if ident.startswith(('platforms;','build-tools;','system-images;')):parts=parts[1:]
   if not parts:continue
   out=dest.joinpath(*parts)
   if info.is_dir():out.mkdir(parents=True,exist_ok=True);continue
   out.parent.mkdir(parents=True,exist_ok=True)
   with z.open(info) as src,out.open('xb') as dst:
    for chunk in iter(lambda:src.read(1024*1024),b''):
     if chunk.count(0)==len(chunk):dst.seek(len(chunk),1)
     else:dst.write(chunk)
    dst.truncate(info.file_size)
   os.chmod(out,((info.external_attr>>16)&0o777) or 0o644)
 print('installed',ident,flush=True)
