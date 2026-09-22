param([switch]$Unpacked, [string]$OutputDirectory = 'release')
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$outputRoot = [IO.Path]::GetFullPath((Join-Path $appRoot $OutputDirectory))
$expectedParent = [IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'
if (-not $outputRoot.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build output must stay under apps/desktop.'
}
$repo = [IO.Path]::GetFullPath((Join-Path $appRoot '..\..'))
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodePath = $node.Source
} else {
    throw 'Install Node.js 22.12+ and add it to PATH before building.'
}
$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
$buildPython = Join-Path $appRoot '.build-venv\Scripts\python.exe'
Push-Location $appRoot
try {
    if (-not (Test-Path -LiteralPath $buildPython)) {
        python -m venv (Join-Path $appRoot '.build-venv')
        if ($LASTEXITCODE -ne 0) { throw 'Isolated build environment creation failed.' }
    }
    & $buildPython -m pip install --disable-pip-version-check -r build-requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Build dependency installation failed.' }
    & $buildPython (Join-Path $repo 'agent_ops\desktop\build_windows.py')
    if ($LASTEXITCODE -ne 0) { throw 'Core packaging failed.' }
    & $nodePath node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    $builderArgs = @('node_modules/electron-builder/cli.js', '--config', 'electron-builder.json', '--win', '--x64', '--publish', 'never')
    $builderArgs += "--config.directories.output=$outputRoot"
    if ($Unpacked) { $builderArgs += '--dir' }
    & $nodePath @builderArgs
    if ($LASTEXITCODE -ne 0) { throw 'Windows package creation failed.' }
    Get-ChildItem -LiteralPath $outputRoot -File -Filter '*Setup*.exe' |
        Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path
} finally {
    Pop-Location
}
