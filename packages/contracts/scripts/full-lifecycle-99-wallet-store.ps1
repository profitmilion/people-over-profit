param(
  [ValidateSet('DryRun', 'Initialize', 'Inspect')]
  [string]$Mode = 'DryRun',
  [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
$ExpectedConfirmation = 'CREATE POP33 BASE SEPOLIA FULL LIFECYCLE 99'
$ContractsDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($TargetDirectory)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is required to select the default external full-lifecycle directory.'
  }
  $TargetDirectory = Join-Path $env:LOCALAPPDATA 'POP33\operator\base-sepolia-full-lifecycle-99'
}
$TargetDirectory = [System.IO.Path]::GetFullPath($TargetDirectory)

Write-Host 'POP33 Base Sepolia full-lifecycle 99-wallet store tool'
Write-Host "  Mode: $Mode"
Write-Host '  Wallet count: 99'
Write-Host "  Target directory: $TargetDirectory"
Write-Host '  No RPC connection, funding, signing, or transaction capability is present.'

$FirstSecure = $null
$SecondSecure = $null
$FirstPointer = [IntPtr]::Zero
$SecondPointer = [IntPtr]::Zero
$FirstPlain = $null
$SecondPlain = $null
$StartInfo = $null
$ChildProcess = $null

try {
  if ($Mode -eq 'Initialize') {
    $Confirmation = Read-Host "Type exactly '$ExpectedConfirmation'"
    if ($Confirmation -cne $ExpectedConfirmation) {
      throw 'Exact full-lifecycle initialization confirmation was not provided.'
    }
    $FirstSecure = Read-Host 'Enter a new wallet-store password' -AsSecureString
    $SecondSecure = Read-Host 'Enter the same wallet-store password again' -AsSecureString
  }
  elseif ($Mode -eq 'Inspect') {
    $FirstSecure = Read-Host 'Enter the existing wallet-store password' -AsSecureString
  }

  if ($null -ne $FirstSecure) {
    $FirstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($FirstSecure)
    $FirstPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($FirstPointer)
    if ($FirstPlain.Length -lt 12) {
      throw 'The wallet-store password must contain at least 12 characters.'
    }
  }
  if ($null -ne $SecondSecure) {
    $SecondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecondSecure)
    $SecondPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($SecondPointer)
    if ($FirstPlain -cne $SecondPlain) {
      throw 'The two wallet-store password entries do not match.'
    }
  }

  $NodePath = (Get-Command node -ErrorAction Stop).Source
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = $NodePath
  $StartInfo.Arguments = 'scripts/full-lifecycle-99-wallet-store-cli.mjs'
  $StartInfo.WorkingDirectory = $ContractsDirectory
  $StartInfo.UseShellExecute = $false
  $StartInfo.EnvironmentVariables['POP33_FULL_LIFECYCLE_MODE'] = $Mode.ToLowerInvariant().Replace('dryrun', 'dry-run')
  $StartInfo.EnvironmentVariables['POP33_FULL_LIFECYCLE_TARGET_DIRECTORY'] = $TargetDirectory
  if ($null -ne $FirstPlain) {
    $StartInfo.EnvironmentVariables['POP33_FULL_LIFECYCLE_PASSWORD_FIRST'] = $FirstPlain
  }
  if ($null -ne $SecondPlain) {
    $StartInfo.EnvironmentVariables['POP33_FULL_LIFECYCLE_PASSWORD_SECOND'] = $SecondPlain
    $StartInfo.EnvironmentVariables['POP33_FULL_LIFECYCLE_CONFIRMATION'] = $ExpectedConfirmation
  }
  try {
    $ChildProcess = [System.Diagnostics.Process]::Start($StartInfo)
  }
  finally {
    foreach ($Name in @(
      'POP33_FULL_LIFECYCLE_MODE',
      'POP33_FULL_LIFECYCLE_TARGET_DIRECTORY',
      'POP33_FULL_LIFECYCLE_PASSWORD_FIRST',
      'POP33_FULL_LIFECYCLE_PASSWORD_SECOND',
      'POP33_FULL_LIFECYCLE_CONFIRMATION'
    )) {
      [void]$StartInfo.EnvironmentVariables.Remove($Name)
    }
  }
  if ($null -eq $ChildProcess) {
    throw 'Unable to start the full-lifecycle wallet-store child process.'
  }
  $ChildProcess.WaitForExit()
  if ($ChildProcess.ExitCode -ne 0) {
    throw "Full-lifecycle wallet-store command exited with code $($ChildProcess.ExitCode)."
  }
}
finally {
  if ($null -ne $StartInfo) {
    foreach ($Name in @(
      'POP33_FULL_LIFECYCLE_MODE',
      'POP33_FULL_LIFECYCLE_TARGET_DIRECTORY',
      'POP33_FULL_LIFECYCLE_PASSWORD_FIRST',
      'POP33_FULL_LIFECYCLE_PASSWORD_SECOND',
      'POP33_FULL_LIFECYCLE_CONFIRMATION'
    )) {
      [void]$StartInfo.EnvironmentVariables.Remove($Name)
    }
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
  [GC]::Collect()
}
