param([Alias('ArchivePrevious')][switch]$NewRun, [string]$Sdk = 'E:\Android\Sdk')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deviceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.kanata-device.local'))
$avdRoot = Join-Path $deviceRoot 'avds'
$avdPath = [IO.Path]::GetFullPath((Join-Path $avdRoot ('KanataP2Synthetic34-' + (Get-Date -Format yyyyMMdd-HHmmss) + '.avd')))
$markerPath = Join-Path $deviceRoot 'isolation.json'
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
if (Test-Path -LiteralPath $markerPath) {
  if (!$NewRun) { throw 'Synthetic run exists. Use -NewRun to preserve it and create a fresh run.' }
  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  if ($marker.name -ne 'KanataP2Synthetic34' -or $marker.serial -ne 'emulator-5580' -or !$marker.syntheticOnly -or !([IO.Path]::GetFullPath($marker.avdPath)).StartsWith($avdRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Existing AVD is not a verified task-created synthetic environment.' }
  $identity = & $adb -s emulator-5580 emu avd name 2>$null
  if ($LASTEXITCODE -eq 0) {
    if (($identity -join "`n").Trim().Split([char[]]" `r`n", [StringSplitOptions]::RemoveEmptyEntries)[0] -ne 'KanataP2Synthetic34') { throw 'Connected AVD identity mismatch.' }
    & $adb -s emulator-5580 emu kill | Out-Null
  }
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $running = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(emulator|qemu-system-x86_64(?:-headless)?)\.exe$' -and $_.CommandLine -match 'KanataP2Synthetic34' }
    if (!$running) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($running) { throw 'Task emulator is still shutting down; no archive attempted.' }
  # Keep the previous disk at its existing path. A fresh unique directory needs no move/delete.
}
if (!$avdPath.StartsWith($avdRoot + [IO.Path]::DirectorySeparatorChar) -or (Test-Path -LiteralPath $avdPath)) { throw 'Fresh task directory is not unique or escapes its root.' }
New-Item -ItemType Directory -Force -Path $avdPath | Out-Null
@"
avd.ini.encoding=UTF-8
path=$avdPath
target=android-34
"@ | Set-Content -LiteralPath (Join-Path $avdRoot 'KanataP2Synthetic34.ini') -Encoding ascii
@"
AvdId=KanataP2Synthetic34
avd.ini.displayname=Kanata P2 new synthetic only
abi.type=x86_64
hw.cpu.arch=x86_64
hw.cpu.ncore=4
hw.ramSize=2048
hw.lcd.density=420
hw.lcd.width=1080
hw.lcd.height=1920
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.keyboard=yes
hw.camera.back=none
hw.camera.front=none
hw.audioInput=no
hw.sdCard=no
disk.dataPartition.size=2G
image.sysdir.1=$Sdk\system-images\android-34\google_apis\x86_64\
tag.id=google_apis
tag.display=Google APIs
target=android-34
showDeviceFrame=no
fastboot.forceColdBoot=yes
PlayStore.enabled=false
"@ | Set-Content -LiteralPath (Join-Path $avdPath 'config.ini') -Encoding ascii
[pscustomobject]@{ name='KanataP2Synthetic34'; avdPath=$avdPath; serial='emulator-5580'; createdAt=(Get-Date).ToString('o'); syntheticOnly=$true; source='New blank AVD; no existing userdata copied' } | ConvertTo-Json | Set-Content -LiteralPath $markerPath
$env:ANDROID_HOME=$Sdk
$env:ANDROID_SDK_ROOT=$Sdk
$env:ANDROID_AVD_HOME=$avdRoot
$stamp = Get-Date -Format yyyyMMdd-HHmmss
Start-Process -FilePath (Join-Path $Sdk 'emulator\emulator.exe') -ArgumentList '-avd','KanataP2Synthetic34','-port','5580','-no-snapshot','-no-audio','-no-boot-anim','-no-window' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $deviceRoot "emulator-$stamp.log") -RedirectStandardError (Join-Path $deviceRoot "emulator-$stamp-error.log") -PassThru | Select-Object Id
