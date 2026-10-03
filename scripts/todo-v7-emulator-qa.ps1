param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
$taskAdb=Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$stage="v7-api$Api"
$env:TODO_QA_SERIAL=$Serial
$env:TODO_QA_USER='0'
$env:TODO_QA_MIN_HIT_PX='68'
$env:TODO_QA_STAGE=$stage
$env:TODO_QA_PIN_NATIVE='1'
if (-not $env:TODO_QA_PIN_COUNT) {$env:TODO_QA_PIN_COUNT='1'}
$avd=(& $taskAdb -s $Serial emu avd name | Select-Object -First 1).Trim()
if ($avd -ne "Codex_Todo_API$Api") { throw 'Only the dedicated Todo AVD may be modified.' }
function Run-AdbTask([string[]]$CommandArgs) {
    $result=& $taskAdb -s $Serial @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw 'ADB operation failed.' }
    return $result
}
function Fixture([int]$Count,[string]$Style='') {
    $command=@('shell','am','instrument','--user','0','-w','-e','class','com.yubin.formyself.TodoWidgetHarness','-e','todoQaAction','fixture','-e','todoQaCount',"$Count")
    if ($Style) {$command+=@('-e','todoQaStyle',$Style)}
    $command+='com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner'
    $result=Run-AdbTask $command
    if (($result -join "`n") -notmatch 'OK \(1 test\)') {throw 'Synthetic fixture setup failed.'}
    # Instrumentation kills its target process. Legacy hosts must rebind the
    # collection factory before inspecting the new synthetic rows.
    Run-AdbTask @('shell','am','start','--user','0','-n','com.yubin.formyself/.MainActivity') | Out-Null
    Run-AdbTask @('shell','am','force-stop','--user','0','com.google.android.apps.nexuslauncher') | Out-Null
    Run-AdbTask @('shell','am','start','--user','0','-a','android.intent.action.MAIN','-c','android.intent.category.HOME') | Out-Null
}
function Python-QA([string]$Script,[string]$Name) {
    & python $Script *> "Test_data/todo-$stage-$Name.log"
    if ($LASTEXITCODE -ne 0) {Get-Content "Test_data/todo-$stage-$Name.log" -Tail 12;throw "$Name QA failed."}
    Get-Content "Test_data/todo-$stage-$Name.log" -Tail 1
}
if ($env:TODO_QA_RESUME_AFTER_NATIVE -eq '1') {
    $native=Get-Content "Test_data/todo-$stage-native-final-warm.log"
    if (($native -join "`n") -notmatch 'OK \(6 tests\)') {throw 'A passing native result is required before resuming.'}
} else {
Run-AdbTask @('install','-r','android/app/build/outputs/apk/debug/app-debug.apk')
Run-AdbTask @('install','-r','android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')
Run-AdbTask @('shell','am','start','--user','0','-n','com.yubin.formyself/.MainActivity') | Out-Null
$native=Run-AdbTask @('shell','am','instrument','--user','0','-w','com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner')
$native | Set-Content "Test_data/todo-$stage-native.log"
if (($native -join "`n") -notmatch 'OK \(6 tests\)') {
    Run-AdbTask @('shell','am','start','--user','0','-n','com.yubin.formyself/.MainActivity') | Out-Null
    $native=Run-AdbTask @('shell','am','instrument','--user','0','-w','com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner')
    $native | Set-Content "Test_data/todo-$stage-native-recheck.log"
    if (($native -join "`n") -notmatch 'OK \(6 tests\)') {throw 'Native regression failed.'}
}
}
try {
    Fixture 4 'reference'
    Python-QA 'scripts/todo-widget-pin-qa.py' 'pin'
    $env:TODO_QA_PREVIEW='reference'
    Python-QA 'scripts/todo-v7-widget-preview-qa.py' 'reference'
    Fixture 30
    if ($env:TODO_QA_SKIP_SPACING -ne '1') {Python-QA 'scripts/todo-v7-widget-spacing-qa.py' 'spacing'}
    & node scripts/todo-widget-qa.mjs $stage *> "Test_data/todo-$stage-widget.log"
    if ($LASTEXITCODE -ne 0) {Get-Content "Test_data/todo-$stage-widget.log" -Tail 12;throw 'Desktop completion/scroll QA failed.'}
    Python-QA 'scripts/todo-v7-widget-stress-qa.py' 'stress'
    Fixture 0
    $env:TODO_QA_PREVIEW='empty'
    Python-QA 'scripts/todo-v7-widget-preview-qa.py' 'empty'
    Fixture 1
    Python-QA 'scripts/todo-v6-widget-animation-qa.py' 'animation'
} finally {
    Python-QA 'scripts/todo-widget-restore-qa.py' 'restore'
}
