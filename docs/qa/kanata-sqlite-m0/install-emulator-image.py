"""Install official API34 ATD archive using sparse files on small cloud disks.
Retains archive bytes/CRC/checksum and every logical image byte, without allocating
8 GiB of zero blocks. Does not alter the image or disable integrity checks.
Run from repository root after downloading the official archive + metadata.
"""
from pathlib import Path
import hashlib, json, zipfile, copy, os, xml.etree.ElementTree as ET

work=Path('work/m0/emulator')
archive=work/'x86_64-34_r02.zip'
digest=hashlib.sha1()
with archive.open('rb') as f:
    for chunk in iter(lambda:f.read(1048576),b''): digest.update(chunk)
assert digest.hexdigest()=='9ce4068934b26fa99ca104ffe6d10dec22abb317'
assert archive.stat().st_size==614898904
target=Path('work/m0/android-sdk/system-images/android-34/aosp_atd')
target.mkdir(parents=True,exist_ok=True)
assert not (target/'x86_64/source.properties').exists(), 'Refuse to overwrite installed image'
files=[]
with zipfile.ZipFile(archive) as z:
    for entry in z.infolist():
        name=Path(entry.filename)
        assert name.parts[0]=='x86_64' and '..' not in name.parts and not name.is_absolute()
        assert (entry.external_attr>>16)&0o170000 != 0o120000
        out=target/name
        assert not out.exists(), 'Refuse to overwrite an existing file'
        if entry.is_dir(): out.mkdir(parents=True,exist_ok=True); continue
        out.parent.mkdir(parents=True,exist_ok=True)
        h=hashlib.sha256()
        with z.open(entry) as source,out.open('xb') as dest:
            for chunk in iter(lambda:source.read(1048576),b''):
                h.update(chunk)
                if chunk.count(0)==len(chunk): dest.seek(len(chunk),os.SEEK_CUR)
                else: dest.write(chunk)
            dest.truncate(entry.file_size)
        s=out.stat()
        files.append({'name':entry.filename,'bytes':s.st_size,'allocatedBytes':s.st_blocks*512,'sha256':h.hexdigest()})

remote=ET.parse(work/'atd-images.xml').getroot()
package=next(p for p in remote if p.attrib.get('path')=='system-images;android-34;aosp_atd;x86_64')
local=copy.deepcopy(package); local.tag='localPackage'
for child in list(local):
    if child.tag in ['archives','channelRef']: local.remove(child)
repo=ET.Element('{http://schemas.android.com/repository/android/common/02}repository',{'xmlns:sys-img':'http://schemas.android.com/sdk/android/repo/sys-img2/04'})
for child in remote:
    if child.tag=='license': repo.append(copy.deepcopy(child))
repo.append(local)
ET.ElementTree(repo).write(target/'x86_64/package.xml',encoding='utf-8',xml_declaration=True)
receipt={'status':'OFFICIAL_IMAGE_INSTALLED_SPARSE','archiveSha1':digest.hexdigest(),'logicalBytes':sum(f['bytes'] for f in files),'allocatedBytes':sum(f['allocatedBytes'] for f in files),'files':files}
(work/'sparse-image-install.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='files'}))
