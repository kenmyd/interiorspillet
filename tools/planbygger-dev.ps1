# Starts the planbygger's dev server on http://127.0.0.1:5270/planbygger.html.
# The AI key is taken from the Windows user environment when this shell does not have it (a shell started before the
# key was set). Run: powershell -ExecutionPolicy Bypass -File tools\planbygger-dev.ps1
if (-not $env:ANTHROPIC_API_KEY) {
  $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')
}
if ($env:ANTHROPIC_API_KEY) { Write-Host 'KI: nøkkelen er satt.' } else { Write-Host 'KI: ingen nøkkel – «Generer» går uten KI.' }
Set-Location (Join-Path $PSScriptRoot '..')
npx vite --config tools/planbygger-vite.config.mjs --port 5270 --strictPort
