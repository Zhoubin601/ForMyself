"""Verify the exact accepted APK and its production assets before delivery."""
import hashlib, json, sys, zipfile
from pathlib import Path

DIRECTORY=Path(__file__).resolve().parent
ROOT=DIRECTORY.parents[3]
apk=(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'output/20261027-ForMyself-architecture-p6-debug-v1.apk').resolve()
accepted=json.loads((DIRECTORY/'playwright-results.json').read_text())
required=['initialization','masterPasswordInitialSave','apiKeyInitialSave','requiredEntryColdStart',
          'optionalEntryInitialSave','optionalEntryColdStart','apiKeyColdStart','onlyRequestedModuleLoaded',
          'vaultUiCreate','chatSendReply','nativeDeepLink','backgroundReleasesSensitiveData',
          'pendingRestoreBlocksColdStart','uncommittedForceStopRollback','committedForceStopRetainsTarget',
          'passwordChangeColdStartPreservesChat','apiKeyAfterPasswordChange','passwordChangeColdStartPreservesVault','nativeScreenshotsRendered','homeReducedMotionLayout']
assert all(accepted.get(key) is True for key in required), {key:accepted.get(key) for key in required}
assert not accepted['pageErrors'], accepted['pageErrors']
digest=hashlib.sha256(apk.read_bytes()).hexdigest()
assert digest==accepted['apkSha256'], 'APK differs from device acceptance'
assert hashlib.sha256((DIRECTORY/'verify.mjs').read_bytes()).hexdigest()==accepted['scriptSha256'], 'Driver differs from device acceptance'
assets=[path for path in (ROOT/'dist').rglob('*') if path.is_file()]
with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None, 'Invalid ZIP CRC'
    mismatches=[str(path.relative_to(ROOT)) for path in assets if archive.read('assets/public/'+path.relative_to(ROOT/'dist').as_posix())!=path.read_bytes()]
    forbidden=[b'window.__qaRuntime',b'synthetic-native-key-only',b'Synthetic-P6-native-only']
    qa_hooks=[name for name in archive.namelist() if name.startswith('assets/public/') and name.endswith('.js') and any(token in archive.read(name) for token in forbidden)]
    test_classes=[name for name in archive.namelist() if name.endswith('.dex') and any(token in archive.read(name) for token in [b'ArchitectureContractTest',b'QaBackgroundActivity'])]
assert not mismatches, mismatches
assert not qa_hooks, qa_hooks
assert not test_classes, test_classes
report={'apk':str(apk.relative_to(ROOT)),'apk_sha256':digest,'bytes':apk.stat().st_size,
        'accepted_script_sha256':accepted['scriptSha256'],'required_native_checks':len(required),
        'production_asset_count':len(assets),'mismatches':mismatches,'packaged_qa_literals':qa_hooks,
        'instrumentation_classes_in_main_apk':test_classes}
(DIRECTORY/'delivery-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
