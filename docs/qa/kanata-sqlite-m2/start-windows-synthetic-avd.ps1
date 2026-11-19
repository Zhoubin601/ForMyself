param(
    [string] $Sdk = 'E:\Android\Sdk',
    [string] $RunsRoot = 'E:\Android',
    [switch] $M5Identity
)
$ErrorActionPreference = 'Stop'
$Sdk = (Resolve-Path -LiteralPath $Sdk).Path
$RunsRoot = (Resolve-Path -LiteralPath $RunsRoot).Path
$image = 'system-images/android-34/google_apis/x86_64'
$properties = Get-Content -LiteralPath (Join-Path $Sdk "$image/source.properties")
if ($properties -notcontains 'AndroidVersion.ApiLevel=34' -or $properties -notcontains 'SystemImage.Abi=x86_64') {
    throw 'API 34 Google APIs x86_64 image required'
}
$adb = Join-Path $Sdk 'platform-tools/adb.exe'
$emulator = Join-Path $Sdk 'emulator/emulator.exe'
$accel = & (Join-Path $Sdk 'emulator/emulator-check.exe') accel
if ($LASTEXITCODE -ne 0 -or -not ($accel -match 'WHPX.*installed and usable')) { throw 'WHPX required' }
$devices = & $adb devices
if ($LASTEXITCODE -ne 0 -or ($devices -match '^emulator-5582\s')) { throw 'Synthetic serial is occupied' }
$instanceId = [guid]::NewGuid().ToString('N')
$root = Join-Path $RunsRoot ('kanata-m2-synthetic-' + $instanceId.Substring(0, 8))
$name = if ($M5Identity) { "kanata_m5_$instanceId" } else { 'kanata_m2_api34' }
if (Test-Path -LiteralPath $root) { throw 'Synthetic run directory already exists' }
$avdHome = Join-Path $root 'avd'
$avd = Join-Path $avdHome "$name.avd"
New-Item -ItemType Directory -Path $root | Out-Null
New-Item -ItemType Directory -Path $avd,(Join-Path $root 'prefs'),(Join-Path $root 'home') | Out-Null
@"
AvdId=$name
PlayStore.enabled=false
abi.type=x86_64
avd.ini.displayname=Kanata M2 isolated API34
avd.ini.encoding=UTF-8
disk.dataPartition.size=2G
fastboot.forceColdBoot=yes
hw.cpu.arch=x86_64
hw.cpu.ncore=4
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader
hw.lcd.density=240
hw.lcd.height=960
hw.lcd.width=540
hw.ramSize=3072
hw.sdCard=no
image.sysdir.1=$image/
tag.id=google_apis
tag.display=Google APIs
vm.heapSize=256
skin.dynamic=yes
showDeviceFrame=no
"@ | Set-Content -Encoding ascii (Join-Path $avd 'config.ini')
@('avd.ini.encoding=UTF-8',"path=$avd",'target=android-34') | Set-Content -Encoding ascii (Join-Path $avdHome "$name.ini")
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:ANDROID_AVD_HOME = $avdHome
$env:ANDROID_USER_HOME = Join-Path $root 'prefs'
$env:ANDROID_EMULATOR_HOME = Join-Path $root 'home'
$arguments = @('-avd',$name,'-port','5582','-accel','on','-no-window','-no-audio','-no-snapshot','-no-metrics','-gpu','swiftshader','-feature','-Vulkan','-verbose')
if ($M5Identity) { $arguments += @('-datadir', ('"' + $avd + '"')) }
$launch = @{
    FilePath = $emulator
    ArgumentList = $arguments
    WindowStyle = 'Hidden'
    PassThru = $true
    RedirectStandardOutput = Join-Path $root 'emulator.stdout.txt'
    RedirectStandardError = Join-Path $root 'emulator.stderr.txt'
}
$child = Start-Process @launch
$manifest = [ordered]@{
    syntheticOnly = $true
    createdBy = 'M2 Windows/WHPX preflight'
    serial = 'emulator-5582'
    avdName = $name
    root = $root
    avdHome = $avdHome
    sdk = $Sdk
    api = 34
    image = $image
    launcherPid = $child.Id
    args = $arguments
}
if ($M5Identity) {
    $manifest.identityVersion = 1
    $manifest.instanceId = $instanceId
    $manifest.dataDirectory = $avd
    $manifest.launcherStarted = $child.StartTime.ToUniversalTime().Ticks.ToString()
    $manifest.expiresAt = [DateTimeOffset]::UtcNow.AddHours(6).ToUnixTimeMilliseconds()
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root 'device-manifest.json')
Write-Output (Join-Path $root 'device-manifest.json')
