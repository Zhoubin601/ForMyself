param([Parameter(Mandatory)][string]$ManifestPath,[string]$EvidenceName='android-action-spike')
$ErrorActionPreference='Stop'
$manifestFile=(Resolve-Path -LiteralPath $ManifestPath).Path
$manifest=Get-Content -Raw -LiteralPath $manifestFile|ConvertFrom-Json
$app='com.yubin.formyself.m2qa'
$serial='emulator-5582'
$root=[IO.Path]::GetFullPath($manifest.root)
if($manifest.syntheticOnly -ne $true -or $manifest.createdBy -ne 'M2 Windows/WHPX preflight' -or
   $manifest.serial -ne $serial -or $manifest.avdName -ne 'kanata_m2_api34' -or
   $root -ne (Split-Path -Parent $manifestFile) -or (Split-Path -Leaf $root) -notmatch '^kanata-m2-synthetic-[a-f0-9]{8}$'){
    throw 'Unexpected synthetic manifest'
}
$adb=Join-Path $manifest.sdk 'platform-tools/adb.exe'
$aapt=Join-Path $manifest.sdk 'build-tools/35.0.0/aapt.exe'
$actualPath=(& $adb -s $serial emu avd path)[0].Trim()
$expectedPath=Join-Path $manifest.avdHome 'kanata_m2_api34.avd'
if($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($actualPath) -ne [IO.Path]::GetFullPath($expectedPath) -or
   (& $adb -s $serial emu avd name)[0].Trim() -ne 'kanata_m2_api34' -or
   (& $adb -s $serial shell getprop ro.build.version.sdk).Trim() -ne '34' -or
   (& $adb -s $serial shell getprop ro.product.cpu.abi).Trim() -ne 'x86_64' -or
   (& $adb -s $serial shell getprop sys.boot_completed).Trim() -ne '1'){
    throw 'Unexpected isolated AVD identity'
}
$allowed=@("package:$app","package:$app.test",'package:com.formyself.qa.m2probe')
$packages=& $adb -s $serial shell pm list packages -3
if($LASTEXITCODE -ne 0 -or ($packages|Where-Object{$_ -notin $allowed})){throw 'Unexpected installed package'}
$accel=& (Join-Path $manifest.sdk 'emulator/emulator-check.exe') accel
if($LASTEXITCODE -ne 0 -or -not ($accel -match 'WHPX.*installed and usable')){throw 'WHPX unavailable'}
if($EvidenceName -notmatch '^android-action-spike(-[a-z0-9]+)?$'){throw 'Unexpected evidence name'}
$evidence=Join-Path $PSScriptRoot $EvidenceName
if(Test-Path -LiteralPath $evidence){throw 'Evidence already exists; keep earlier evidence'}
New-Item -ItemType Directory -Path $evidence|Out-Null
[ordered]@{serial=$serial;avd='kanata_m2_api34';avdPath=$actualPath;api=34;abi='x86_64';
    fingerprint=(& $adb -s $serial shell getprop ro.build.fingerprint).Trim();
    packages=@($packages);acceleration=@($accel)}|ConvertTo-Json|Set-Content -Encoding utf8 "$evidence/device.json"
foreach($spec in @(
  @{id=$app;file='android/app/build/outputs/apk/debug/app-debug.apk'},
  @{id="$app.test";file='android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'})){
    $apk=(Resolve-Path -LiteralPath $spec.file).Path
    $badging=& $aapt dump badging $apk
    if($LASTEXITCODE -ne 0 -or -not ($badging -match "^package: name='$([regex]::Escape($spec.id))'")){throw 'APK identity mismatch'}
    $badging|Set-Content -Encoding utf8 "$evidence/$($spec.id)-badging.txt"
    & $adb -s $serial install -r -t $apk > "$evidence/$($spec.id)-install.txt"
    if($LASTEXITCODE -ne 0){throw 'QA install failed'}
    $remote=(& $adb -s $serial shell pm path $spec.id)-replace '^package:',''
    if($remote -notmatch '^/data/app/.+/base\.apk$'){throw 'Unexpected installed APK path'}
    # Read-back only the explicitly whitelisted synthetic APK, never app data.
    $copy=Join-Path $root ('er1-'+[guid]::NewGuid().ToString('N')+'.apk')
    & $adb -s $serial pull $remote $copy > "$evidence/$($spec.id)-readback.txt"
    $sha=(Get-FileHash -LiteralPath $apk).Hash
    if($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $copy).Hash -ne $sha){throw 'Installed APK hash mismatch'}
    "$($spec.id) $sha"|Add-Content -Encoding utf8 "$evidence/apk-sha256.txt"
}
# No pm clear, no production launch, no backup or real data access. Test creates
# and deletes only its own new random encrypted cache DB.
& $adb -s $serial shell am instrument -w -r -e class com.yubin.formyself.KanataEventActionCompatibilityTest "$app.test/androidx.test.runner.AndroidJUnitRunner" > "$evidence/instrumentation.txt"
$result=$LASTEXITCODE
& $adb -s $serial logcat -d -s 'ER1_ACTION_SPIKE:I' '*:S' > "$evidence/logcat.txt"
if($result -ne 0 -or (Get-Content -Raw "$evidence/instrumentation.txt") -notmatch 'OK \(1 test\)'){throw 'Action spike failed; retain logs'}
Get-Content -LiteralPath "$evidence/instrumentation.txt"
