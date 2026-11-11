param([Parameter(Mandatory)][string]$ManifestPath)
$ErrorActionPreference='Stop'
$previous=Get-Content -Raw docs/qa/kanata-sqlite-m4/m4-r/event-compat/fingerprints.json | ConvertFrom-Json
$mismatches=@()
$entries=@($previous.sourceFiles.PSObject.Properties)
foreach($entry in $entries){
  if(!(Test-Path -LiteralPath $entry.Name) -or
      (Get-FileHash -LiteralPath $entry.Name -Algorithm SHA256).Hash.ToLower() -ne $entry.Value){
    $mismatches+=$entry.Name
  }
}
if($mismatches.Count){throw "Source fingerprints changed: $($mismatches -join ', ')"}
git diff --exit-code $previous.sourceCommit HEAD -- src tests scripts android package.json package-lock.json
if($LASTEXITCODE -ne 0){throw 'Implementation differs from tested source'}
$evidence=@()
foreach($entry in $previous.evidence.PSObject.Properties){
  $path=Join-Path 'docs/qa/kanata-sqlite-m4/m4-r/event-compat' $entry.Name
  if((Get-FileHash -LiteralPath $path).Hash.ToLower() -ne $entry.Value.sha256){throw 'Evidence checksum mismatch'}
  $evidence+=$entry.Name
}
$manifestFile=(Resolve-Path -LiteralPath $ManifestPath).Path
$manifest=Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
if($manifest.syntheticOnly -ne $true -or $manifest.createdBy -ne 'M2 Windows/WHPX preflight' -or
  $manifest.serial -ne 'emulator-5582' -or $manifest.avdName -ne 'kanata_m2_api34' -or
  $manifest.root -ne (Split-Path -Parent $manifestFile) -or
  (Split-Path -Leaf $manifest.root) -notmatch '^kanata-m2-synthetic-[a-f0-9]{8}$') {throw 'Manifest mismatch'}
$adb=Join-Path $manifest.sdk 'platform-tools/adb.exe'
function Read-Adb([string[]]$Arguments){
  $result=& $adb -s $manifest.serial @Arguments
  if($LASTEXITCODE -ne 0){throw 'Read-only ADB command failed'}
  return $result
}
$avd=(Read-Adb @('emu','avd','path'))[0].Trim()
if($avd -ne (Join-Path $manifest.avdHome ($manifest.avdName+'.avd'))){throw 'AVD path mismatch'}
if((Read-Adb @('emu','avd','name'))[0].Trim() -ne $manifest.avdName){throw 'AVD name mismatch'}
$api=(Read-Adb @('shell','getprop','ro.build.version.sdk')).Trim()
$abi=(Read-Adb @('shell','getprop','ro.product.cpu.abi')).Trim()
$fingerprint=(Read-Adb @('shell','getprop','ro.build.fingerprint')).Trim()
if($api -ne '34' -or $abi -ne 'x86_64'){throw 'API/ABI mismatch'}
$oldDevice=Get-Content -Raw docs/qa/kanata-sqlite-m4/m4-r/event-compat/android-action-spike-final/device.json | ConvertFrom-Json
if($fingerprint -ne $oldDevice.fingerprint -or $avd -ne $oldDevice.avdPath){throw 'Historical device fingerprint/path mismatch'}
$allowed=@('package:com.yubin.formyself.m2qa','package:com.yubin.formyself.m2qa.test','package:com.formyself.qa.m2probe')
$packages=@(Read-Adb @('shell','pm','list','packages','-3'))
if($packages | Where-Object { $_.Trim() -notin $allowed }){throw 'Unexpected non-system package'}
$apks=@{}
foreach($package in @('com.yubin.formyself.m2qa','com.yubin.formyself.m2qa.test')){
  $remote=(Read-Adb @('shell','pm','path',$package)).Trim() -replace '^package:',''
  if($remote -notmatch '^/data/app/[^\s]+/base\.apk$'){throw 'Unexpected APK path'}
  $hash=((Read-Adb @('shell','sha256sum',$remote)) -split '\s+')[0]
  if($hash -ne $previous.apks."$package-base.apk"){throw 'Installed APK fingerprint mismatch'}
  $apks[$package]=$hash
}
$ordinary='android/app/build/outputs/apk/debug/app-debug.apk'
if((Get-FileHash -LiteralPath $ordinary).Hash.ToLower() -ne $previous.apks.'ordinary-apk'){throw 'Ordinary APK mismatch'}
$catalog='android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json'
if((Get-FileHash -LiteralPath $catalog).Hash.ToLower() -ne $previous.ordinaryCatalogSha256){throw 'Ordinary catalog mismatch'}
$candidate=Join-Path $manifest.root 'er1-final-regression-20261111/com.yubin.formyself.m2qa-base.apk'
if((Get-FileHash -LiteralPath $candidate).Hash.ToLower() -ne $apks['com.yubin.formyself.m2qa']){throw 'Candidate archive mismatch'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($candidate)
try{
  $entry=$zip.GetEntry('assets/kanata-sqlite-catalog.json')
  if(!$entry){throw 'Candidate catalog missing'}
  $stream=$entry.Open()
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$candidateCatalog=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLower()}
  finally{$stream.Dispose();$sha.Dispose()}
}finally{$zip.Dispose()}
$priorCatalog=Get-Content -Raw docs/qa/kanata-sqlite-m4/m4-r/event-compat/21-candidate-catalog-sha256.json | ConvertFrom-Json
if($candidateCatalog -ne $priorCatalog.Hash.ToLower()){throw 'Candidate catalog checksum mismatch'}
$accel=& (Join-Path $manifest.sdk 'emulator/emulator-check.exe') accel
if($LASTEXITCODE -ne 0 -or ($accel -join "`n") -notmatch 'WHPX'){throw 'WHPX unavailable'}
[ordered]@{
  status='PASS'; scope='Read-only identity and evidence reuse audit, not a new Android business run'
  head=(git rev-parse HEAD); sourceCommit=$previous.sourceCommit; sourceFilesChecked=$entries.Count
  sourceMismatches=$mismatches; evidenceArchivesChecked=$evidence
  fixtureUnchanged=$true; device=[ordered]@{serial=$manifest.serial;avd=$manifest.avdName;path=$avd;api=$api;abi=$abi;fingerprint=$fingerprint;acceleration=$accel;packages=$packages}
  installedApks=$apks; candidateCatalog=$candidateCatalog; ordinaryApk=$previous.apks.'ordinary-apk'
  ordinaryCatalog=$previous.ordinaryCatalogSha256
  sqlcipher='4.17.0 community in reused instrumented evidence; not executed again'
  actualModelRequests=0; appDataRead=$false; appDataModified=$false
} | ConvertTo-Json -Depth 6
