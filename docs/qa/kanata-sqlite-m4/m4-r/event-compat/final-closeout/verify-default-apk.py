"""Read-only inspection of an ordinary APK; never installs or opens app data."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
import zipfile

manifest_path = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
root = Path(manifest['root']).resolve()
assert manifest['syntheticOnly'] is True and manifest['createdBy'] == 'M2 Windows/WHPX preflight'
assert root == manifest_path.parent and re.fullmatch(r'kanata-m2-synthetic-[a-f0-9]{8}', root.name)
apk = Path('android/app/build/outputs/apk/debug/app-debug.apk').resolve()
tools = Path(manifest['sdk']) / 'build-tools/35.0.0'
badging = subprocess.check_output([str(tools / 'aapt.exe'), 'dump', 'badging', str(apk)]).decode('utf-8')
assert re.search(r"^package: name='com.yubin.formyself' ", badging, re.M)
activation = None
with zipfile.ZipFile(apk) as archive:
    catalog_bytes = archive.read('assets/kanata-sqlite-catalog.json')
    catalog = json.loads(catalog_bytes)
    assert catalog['version'] == 5
    assert b'M2_SQLCIPHER_SYNTHETIC' not in archive.read('assets/public/index.html')
    assert not any(name.startswith('assets/public/m2') for name in archive.namelist())
    for name in archive.namelist():
        if not re.fullmatch(r'classes\d*\.dex', name):
            continue
        # Only this fresh, uniquely named temporary file is removed below.
        temporary = root / ('event-default-gate-' + uuid.uuid4().hex + '.dex')
        assert temporary.resolve().parent == root and not temporary.exists()
        try:
            with temporary.open('xb') as handle:
                handle.write(archive.read(name))
            dump = subprocess.check_output([str(tools / 'dexdump.exe'), '-l', 'xml', str(temporary)],
                                           stderr=subprocess.DEVNULL)
            tree = ET.fromstring(dump)
            for package in tree.iter('package'):
                if package.get('name') != 'com.yubin.formyself':
                    continue
                for cls in package.findall('class'):
                    if cls.get('name') != 'BuildConfig':
                        continue
                    for field in cls.findall('field'):
                        if field.get('name') == 'KANATA_M2_SYNTHETIC':
                            assert activation is None
                            activation = field.get('value')
        finally:
            temporary.unlink()
assert activation == 'false', 'The packaged DEX activation flag must be false'
fixture_sql = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import {growthSeedSql} from './docs/qa/kanata-sqlite-m4/fixture.mjs';
import {eventRows,memoryRows,eventEdges,eventFanout,replayEventRows,replayEffectRows,grantOriginActors}
  from './docs/qa/kanata-sqlite-m4/completion/fixture.mjs';
import {orderFixtureWrites,longAuditFixtureWrites}
  from './docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/event-semantics-device.mjs';
import {messageAuditSummary,messageAuditCount,messageFixtureWrites}
  from './docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/message-bounded-device.mjs';
console.log(JSON.stringify([growthSeedSql,eventRows,memoryRows,eventEdges,eventFanout,replayEventRows,
  replayEffectRows,grantOriginActors,...orderFixtureWrites,...longAuditFixtureWrites,messageAuditSummary,messageAuditCount,...messageFixtureWrites]));
"""] ).decode('utf-8'))
registered = {entry['sql'] for entry in catalog['statements'].values()}
assert not registered.intersection(fixture_sql), 'Synthetic fixture SQL is packaged'
canonical = subprocess.check_output(['node', '--input-type=module', '-e', """
import {kanataCanonicalStorage} from './src/application/kanataSqliteCandidate.js';
console.log(kanataCanonicalStorage);
"""]).decode('utf-8').strip()
assert canonical == 'legacy'
report = {'package': 'com.yubin.formyself', 'canonical': canonical, 'syntheticActivation': False,
          'activationEvidence': 'Packaged DEX BuildConfig.KANATA_M2_SYNTHETIC=false',
          'syntheticPageAbsent': True, 'syntheticStatementsAbsent': True,
          'syntheticFixtureStatementsChecked': len(fixture_sql), 'schemaVersion': 5,
          'catalogEntries': len(catalog['statements']), 'catalogSha256': hashlib.sha256(catalog_bytes).hexdigest(),
          'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'installed': False, 'published': False}
destination = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent / 'event-bounded-default-gate.json'
assert destination.parent == Path(__file__).resolve().parent, 'Evidence must stay in the current QA directory'
with destination.open('x', encoding='utf-8', newline='\n') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
print(json.dumps(report, ensure_ascii=False))
