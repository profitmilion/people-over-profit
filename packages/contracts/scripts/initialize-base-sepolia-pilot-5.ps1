param(
  [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
$ExpectedConfirmation = 'CREATE POP33 BASE SEPOLIA PILOT 5'
$ContractsDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($TargetDirectory)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is required to select the default external pilot directory.'
  }
  $TargetDirectory = Join-Path $env:LOCALAPPDATA 'POP33\operator\base-sepolia-pilot-5'
}
$TargetDirectory = [System.IO.Path]::GetFullPath($TargetDirectory)

Write-Host 'POP33 secure pilot operator-set initializer'
Write-Host '  Project: POP33'
Write-Host '  Network: Base Sepolia'
Write-Host '  Chain ID: 84532'
Write-Host '  Wallet count: 5'
Write-Host "  Target directory: $TargetDirectory"
Write-Host '  No wallet will be funded and no transaction will be sent.'

$Confirmation = Read-Host "Type exactly '$ExpectedConfirmation'"
if ($Confirmation -cne $ExpectedConfirmation) {
  throw 'Exact pilot initialization confirmation was not provided.'
}

$FirstSecure = $null
$SecondSecure = $null
$FirstPointer = [IntPtr]::Zero
$SecondPointer = [IntPtr]::Zero
$FirstPlain = $null
$SecondPlain = $null
$PreviousLocation = Get-Location
$StartInfo = $null
$ChildProcess = $null

try {
  $FirstSecure = Read-Host 'Enter a new wallet-store password' -AsSecureString
  $SecondSecure = Read-Host 'Enter the same wallet-store password again' -AsSecureString
  $FirstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($FirstSecure)
  $SecondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecondSecure)
  $FirstPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($FirstPointer)
  $SecondPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($SecondPointer)
  if ($FirstPlain -cne $SecondPlain) {
    throw 'The two wallet-store password entries do not match.'
  }
  if ($FirstPlain.Length -lt 12) {
    throw 'The wallet-store password must contain at least 12 characters.'
  }

  $NodePath = (Get-Command node -ErrorAction Stop).Source
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = $NodePath
  $StartInfo.Arguments = 'scripts/initialize-base-sepolia-pilot-5-cli.mjs'
  $StartInfo.WorkingDirectory = $ContractsDirectory
  $StartInfo.UseShellExecute = $false
  $StartInfo.EnvironmentVariables['POP33_PILOT_TARGET_DIRECTORY'] = $TargetDirectory
  $StartInfo.EnvironmentVariables['POP33_PILOT_PASSWORD_FIRST'] = $FirstPlain
  $StartInfo.EnvironmentVariables['POP33_PILOT_PASSWORD_SECOND'] = $SecondPlain
  $StartInfo.EnvironmentVariables['POP33_PILOT_INITIALIZER_CONFIRMATION'] = $ExpectedConfirmation
  try {
    $ChildProcess = [System.Diagnostics.Process]::Start($StartInfo)
  }
  finally {
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_TARGET_DIRECTORY')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_PASSWORD_FIRST')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_PASSWORD_SECOND')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_INITIALIZER_CONFIRMATION')
  }
  if ($null -eq $ChildProcess) {
    throw 'Unable to start the pilot initializer child process.'
  }
  $ChildProcess.WaitForExit()
  if ($ChildProcess.ExitCode -ne 0) {
    throw "Pilot initializer exited with code $($ChildProcess.ExitCode)."
  }
}
finally {
  if ($null -ne $StartInfo) {
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_TARGET_DIRECTORY')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_PASSWORD_FIRST')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_PASSWORD_SECOND')
    [void]$StartInfo.EnvironmentVariables.Remove('POP33_PILOT_INITIALIZER_CONFIRMATION')
  }
  if ($FirstPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($FirstPointer)
  }
  if ($SecondPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($SecondPointer)
  }
  $FirstPlain = $null
  $SecondPlain = $null
  if ($null -ne $FirstSecure) { $FirstSecure.Dispose() }
  if ($null -ne $SecondSecure) { $SecondSecure.Dispose() }
  if ($null -ne $ChildProcess) { $ChildProcess.Dispose() }
  Set-Location -LiteralPath $PreviousLocation
  [GC]::Collect()
}
