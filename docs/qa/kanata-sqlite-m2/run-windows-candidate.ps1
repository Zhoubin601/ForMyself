param(
    [Parameter(Mandatory)] [string] $ManifestPath,
    [Parameter(Mandatory)] [string] $EvidenceDirectory,
    [ValidateSet('repository','full','mr1-fanout','mr1-verify')] [string] $Mode = 'full',
    [switch] $M4Growth,
    [switch] $M4Completion
)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$serial = 'emulator-5582'
$app = 'com.yubin.formyself.m2qa'
if ($manifest.syntheticOnly -ne $true -or $manifest.createdBy -ne 'M2 Windows/WHPX preflight' -or
    $manifest.serial -ne $serial -or $manifest.avdName -ne 'kanata_m2_api34' -or
    $manifest.root -ne (Split-Path -Parent $manifestPath) -or
    (Split-Path -Leaf $manifest.root) -notmatch '^kanata-m2-synthetic-[a-f0-9]{8}$') {
    throw 'Unexpected synthetic manifest'
}
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if ((Split-Path -Parent $evidence) -ne $manifest.root -or (Test-Path -LiteralPath $evidence)) {
    throw 'Evidence output must be a new directory in the isolated run'
}
$adb = Join-Path $manifest.sdk 'platform-tools/adb.exe'
$aapt = Join-Path $manifest.sdk 'build-tools/35.0.0/aapt.exe'
if ((& $adb -s $serial emu avd name)[0].Trim() -ne $manifest.avdName -or
    (& $adb -s $serial shell getprop ro.build.version.sdk) -ne '34' -or
    (& $adb -s $serial shell getprop sys.boot_completed) -ne '1') {
    throw 'Unexpected AVD'
}
$allowed = @("package:$app", "package:$app.test", 'package:com.formyself.qa.m2probe')
$apps = & $adb -s $serial shell pm list packages -3
if ($LASTEXITCODE -ne 0 -or ($apps | Where-Object { $_ -notin $allowed })) { throw 'Unexpected AVD packages' }
New-Item -ItemType Directory -Path $evidence | Out-Null

foreach ($spec in @(
    @{ id = $app; file = 'android/app/build/outputs/apk/debug/app-debug.apk' },
    @{ id = "$app.test"; file = 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk' }
)) {
    $apk = (Resolve-Path -LiteralPath $spec.file).Path
    $badging = & $aapt dump badging $apk
    if ($LASTEXITCODE -ne 0 -or -not ($badging -match "^package: name='$([regex]::Escape($spec.id))'")) { throw 'Unexpected APK' }
    $badging > "$evidence/$($spec.id)-badging.txt"
    & $adb -s $serial install -r -t $apk > "$evidence/$($spec.id)-install.txt"
    if ($LASTEXITCODE -ne 0) { throw 'APK install failed' }
    $remote = (& $adb -s $serial shell pm path $spec.id) -replace '^package:', ''
    if ($remote -notmatch '^/data/app/.+/base\.apk$') { throw 'Unexpected installed APK' }
    $readback = "$evidence/$($spec.id)-base.apk"
    & $adb -s $serial pull $remote $readback
    $sha = (Get-FileHash -LiteralPath $apk).Hash
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $readback).Hash -ne $sha) { throw 'Installed APK fingerprint mismatch' }
    "$($spec.id) $sha" >> "$evidence/apk-sha256.txt"
}

# The isolated QA package is verified above. The production package is never installed.
if ((& $adb -s $serial shell pm clear $app) -ne 'Success') { throw 'Synthetic reset failed' }
& $adb -s $serial logcat -c
& $adb -s $serial shell am instrument -w -r -e class com.yubin.formyself.KanataSqliteTransactionTest "$app.test/androidx.test.runner.AndroidJUnitRunner" > "$evidence/instrumentation.txt"
if ($LASTEXITCODE -ne 0 -or (Get-Content -Raw "$evidence/instrumentation.txt") -notmatch 'OK \(1 test\)') { throw 'Instrumentation failed' }
& $adb -s $serial shell am start -W -n "$app/com.yubin.formyself.MainActivity" > "$evidence/launch.txt"
if ($LASTEXITCODE -ne 0 -or (Get-Content -Raw "$evidence/launch.txt") -notmatch 'Status: ok') { throw 'QA launch failed' }
$scenarioArgs = @($manifestPath, "--$Mode")
if ($M4Growth) { $scenarioArgs += '--m4-growth' }
if ($M4Completion) { $scenarioArgs += '--m4-completion' }
node docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs @scenarioArgs *> "$evidence/result.txt"
$code = $LASTEXITCODE
& $adb -s $serial logcat -d -v threadtime > "$evidence/logcat.txt"
Get-Content -LiteralPath "$evidence/result.txt"
exit $code
