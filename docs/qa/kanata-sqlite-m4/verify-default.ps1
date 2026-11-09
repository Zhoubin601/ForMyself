$ErrorActionPreference = 'Stop'
$apk = (Resolve-Path 'android/app/build/outputs/apk/debug/app-debug.apk').Path
$buildConfig = 'android/app/build/generated/source/buildConfig/debug/com/yubin/formyself/BuildConfig.java'
if ((Get-Content -Raw $buildConfig) -notmatch 'boolean KANATA_M2_SYNTHETIC = false;') {
  throw 'Default BuildConfig did not disable SQLite candidate'
}
$aapt = Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/aapt.exe'
$badging = & $aapt dump badging $apk
if ($LASTEXITCODE -ne 0 -or -not ($badging -match "^package: name='com.yubin.formyself'")) {
  throw 'Default package identity mismatch'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
  $catalogEntry = $archive.GetEntry('assets/kanata-sqlite-catalog.json')
  if (!$catalogEntry) { throw 'Catalog absent from default APK' }
  $reader = [IO.StreamReader]::new($catalogEntry.Open())
  try { $rawCatalog = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $catalog = $rawCatalog | ConvertFrom-Json
  $baseline = Get-Content -Raw 'docs/qa/kanata-sqlite-m3/evidence/schema-fingerprints.json' | ConvertFrom-Json
  if ($catalog.version -ne 4 -or ($catalog.journal.checksum -join ',') -ne ($baseline.checksum -join ',')) {
    throw 'Applied schema history changed'
  }
  if ($rawCatalog -match 'm4-seed-turn|PRAGMA user_version = 999|m2-android-|synthetic-user') {
    throw 'Synthetic statement included in default APK'
  }
  $indexEntry = $archive.GetEntry('assets/public/index.html')
  if (!$indexEntry) { throw 'Application WebView entry absent' }
  $reader = [IO.StreamReader]::new($indexEntry.Open())
  try {
    if ($reader.ReadToEnd().Contains('M2_SQLCIPHER_SYNTHETIC')) { throw 'Synthetic page included in default APK' }
  } finally { $reader.Dispose() }
  [ordered]@{
    package = 'com.yubin.formyself'
    syntheticActivation = $false
    syntheticPageAbsent = $true
    syntheticStatementsAbsent = $true
    schemaVersion = $catalog.version
    catalogEntries = @($catalog.statements.PSObject.Properties).Count
    apkSha256 = (Get-FileHash -LiteralPath $apk).Hash
  } | ConvertTo-Json
} finally { $archive.Dispose() }
