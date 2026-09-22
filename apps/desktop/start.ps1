param([switch]$Preview, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodePath = $node.Source
} else {
    throw 'Install Node.js 22.12+ and add it to PATH.'
}
$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
Push-Location $appRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules'))) {
        throw 'Run npm ci in apps/desktop first.'
    }
    if ($Preview) {
        & $nodePath 'node_modules/vite/bin/vite.js' '--host' '127.0.0.1'
        exit $LASTEXITCODE
    }
    & $nodePath 'node_modules/vite/bin/vite.js' 'build'
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    if (-not $BuildOnly) {
        & $nodePath 'node_modules/electron/install.js'
        if ($LASTEXITCODE -ne 0) { throw 'Electron installation failed.' }
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Start-Process -FilePath (Join-Path $appRoot 'node_modules/electron/dist/electron.exe') -ArgumentList '.' -WorkingDirectory $appRoot
    }
} finally {
    Pop-Location
}
