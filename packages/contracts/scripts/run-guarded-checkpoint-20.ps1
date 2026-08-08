param(
  [ValidateSet('Plan', 'Inspect', 'Simulate')]
  [string]$Mode = 'Plan',
  [string]$Candidate = '',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$arguments = @('run', 'operator:base-sepolia:checkpoint-20', '--')
$arguments += "--$($Mode.ToLowerInvariant())"
if ($Candidate) {
  if ($Mode -ne 'Inspect') { throw 'Candidate is allowed only in Inspect mode.' }
  $arguments += @('--candidate', $Candidate)
}
if ($Json) { $arguments += '--json' }

Write-Host 'POP33 Guarded Checkpoint-20 Runner'
Write-Host "Mode: $Mode"
Write-Host 'EXECUTE is not implemented or authorized. This launcher cannot send transactions.'
& npm @arguments
exit $LASTEXITCODE
