[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$pilotDirectory = Join-Path $env:LOCALAPPDATA 'POP33\operator\base-sepolia-pilot-5'
$contractsDirectory = Split-Path -Parent $PSScriptRoot
$walletStore = Join-Path $pilotDirectory 'pilot-5.operator-wallets.enc.json'
$checkpoint = Join-Path $pilotDirectory 'pilot-5.operator-checkpoint.json'
$journal = Join-Path $pilotDirectory 'pilot-5.operator-journal.json'
$manifest = Join-Path $pilotDirectory 'pilot-5.operator-set-manifest.json'
$rpcUrl = if ($env:BASE_SEPOLIA_SMOKE_RPC_URL) { $env:BASE_SEPOLIA_SMOKE_RPC_URL } else { 'https://sepolia.base.org' }
$networkPhrase = 'CONFIRM POP33 BASE SEPOLIA PILOT 2'
$flowPhrase = 'CONFIRM FAUCET APPROVE JOIN WITHDRAW FOR WALLETS 0 AND 1'
$password = $null
$passwordText = $null
$passwordPointer = [IntPtr]::Zero
$startInfo = $null
$process = $null
$childEnvironmentNames = @(
  'BASE_SEPOLIA_SMOKE_RPC_URL',
  'OPERATOR_WALLET_STORE_PATH',
  'OPERATOR_CHECKPOINT_PATH',
  'OPERATOR_TRANSACTION_JOURNAL_PATH',
  'OPERATOR_SET_MANIFEST_PATH',
  'OPERATOR_WALLET_STORE_PASSWORD',
  'POP33_PILOT_2_NETWORK_CONFIRM',
  'POP33_PILOT_2_FLOW_CONFIRM'
)

Write-Host 'POP33 Base Sepolia guarded write pilot'
Write-Host 'Chain: 84532 (Base Sepolia)'
Write-Host 'Contract: 0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F'
Write-Host 'Token: 0xA7FA084b34c888061757d4b5FBb08a7B53fee786'
Write-Host 'Wallet indices: 0 and 1 only; pool: #1 only'
Write-Host 'Flow: faucet -> exact 33 dUSDC approve -> join -> verify -> withdraw -> verify'
Write-Host 'No funding, draw, claim, deployment, admin call, or wallet indices 2-4 are available.'
Write-Host 'STOP now unless both pilot wallets were manually funded with Base Sepolia ETH.'

$enteredNetworkPhrase = Read-Host "Type exactly: $networkPhrase"
if ($enteredNetworkPhrase -cne $networkPhrase) { throw 'Exact Base Sepolia pilot confirmation did not match.' }
$enteredFlowPhrase = Read-Host "Type exactly: $flowPhrase"
if ($enteredFlowPhrase -cne $flowPhrase) { throw 'Exact two-wallet flow confirmation did not match.' }
$password = Read-Host 'Pilot wallet-store password' -AsSecureString

foreach ($path in @($walletStore, $checkpoint, $journal, $manifest)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required pilot artifact is missing: $path" }
}

$immutableBefore = @{
  walletStore = (Get-FileHash -LiteralPath $walletStore -Algorithm SHA256).Hash
  manifest = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash
}

try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $passwordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = (Get-Command node -ErrorAction Stop).Source
  $startInfo.Arguments = 'scripts/base-sepolia-pilot-2-write-cli.mjs --write-pilot-2'
  $startInfo.WorkingDirectory = $contractsDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.EnvironmentVariables['BASE_SEPOLIA_SMOKE_RPC_URL'] = $rpcUrl
  $startInfo.EnvironmentVariables['OPERATOR_WALLET_STORE_PATH'] = $walletStore
  $startInfo.EnvironmentVariables['OPERATOR_CHECKPOINT_PATH'] = $checkpoint
  $startInfo.EnvironmentVariables['OPERATOR_TRANSACTION_JOURNAL_PATH'] = $journal
  $startInfo.EnvironmentVariables['OPERATOR_SET_MANIFEST_PATH'] = $manifest
  $startInfo.EnvironmentVariables['OPERATOR_WALLET_STORE_PASSWORD'] = $passwordText
  $startInfo.EnvironmentVariables['POP33_PILOT_2_NETWORK_CONFIRM'] = $networkPhrase
  $startInfo.EnvironmentVariables['POP33_PILOT_2_FLOW_CONFIRM'] = $flowPhrase
  try {
    $process = [System.Diagnostics.Process]::Start($startInfo)
  } finally {
    foreach ($name in $childEnvironmentNames) { [void]$startInfo.EnvironmentVariables.Remove($name) }
  }
  if ($null -eq $process) { throw 'Unable to start the guarded pilot child process.' }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Guarded pilot stopped with exit code $($process.ExitCode)." }
} finally {
  if ($null -ne $startInfo) {
    foreach ($name in $childEnvironmentNames) { [void]$startInfo.EnvironmentVariables.Remove($name) }
  }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $passwordText = $null
  if ($null -ne $password) { $password.Dispose() }
  if ($null -ne $process) { $process.Dispose() }
  $password = $null
  Remove-Variable enteredNetworkPhrase, enteredFlowPhrase -ErrorAction SilentlyContinue
  [GC]::Collect()
  $immutableAfter = @{
    walletStore = (Get-FileHash -LiteralPath $walletStore -Algorithm SHA256).Hash
    manifest = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash
  }
  if ($immutableBefore.walletStore -ne $immutableAfter.walletStore -or $immutableBefore.manifest -ne $immutableAfter.manifest) {
    throw 'Immutable pilot wallet store or manifest changed; stop and investigate.'
  }
}
Write-Host 'Immutable wallet store and manifest hashes are unchanged.'
Write-Host 'The checkpoint and journal were intentionally updated with public transaction evidence.'
