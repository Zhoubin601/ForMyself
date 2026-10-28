param([string]$Output = 'docs/qa/kanata-local-20261028/production-build-verification.json')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$apkPath=Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
$distPath=Join-Path $projectRoot 'dist'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($apkPath)
try {
  if ($archive.Entries.FullName | Where-Object { $_ -match 'kanataQA-' }) { throw 'Production APK contains test harness' }
  $rows=foreach ($item in Get-ChildItem -LiteralPath $distPath -Recurse -File) {
    $relative=[IO.Path]::GetRelativePath($distPath,$item.FullName).Replace('\','/')
    $entry=$archive.GetEntry('assets/public/'+$relative)
    if (!$entry) { throw "APK missing dist resource: $relative" }
    $stream=$entry.Open()
    try {
      $algorithm=[Security.Cryptography.SHA256]::Create()
      try { $actual=[Convert]::ToHexString($algorithm.ComputeHash($stream)).ToLowerInvariant() }
      finally { $algorithm.Dispose() }
    } finally { $stream.Dispose() }
    $expected=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "APK resource mismatch: $relative" }
    [pscustomobject]@{path=$relative;sha256=$actual}
  }
  [pscustomobject]@{status='PASS';at=(Get-Date).ToString('o');apkSha256=(Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant();resourceCount=@($rows).Count;qaHarnessAbsent=$true;resources=@($rows)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $projectRoot $Output)
  Write-Output "Production APK verified: $(@($rows).Count) matching resources; QA harness absent."
} finally { $archive.Dispose() }
