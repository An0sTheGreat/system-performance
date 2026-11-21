# Builds dist\SystemPerformance.exe as a single file.
#   ./build.ps1              needs the .NET 10 desktop runtime on the PC that runs it
#   ./build.ps1 -Standalone  bundles the runtime (bigger exe, runs anywhere on Windows x64)
param([switch]$Standalone)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  function Step($name, [scriptblock]$run) { Write-Host "== $name"; & $run; if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" } }
  if (Get-Command node -ErrorAction SilentlyContinue) { Step 'UI tests' { node --test "tests/*.test.mjs" } }
  Step 'Publish' {
    dotnet publish src/SystemPerformance -c Release -r win-x64 --self-contained $Standalone `
      -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=$Standalone -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none `
      -o dist --nologo -v quiet
  }
  Step 'Self-check' { $p = Start-Process dist/SystemPerformance.exe -ArgumentList '--selfcheck' -PassThru -Wait; $global:LASTEXITCODE = $p.ExitCode }
  Remove-Item dist/*.xml -ErrorAction SilentlyContinue
  Write-Host "Built $(Resolve-Path dist/SystemPerformance.exe)"
} finally { Pop-Location }
