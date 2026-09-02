[CmdletBinding()]
param(
    [switch]$RemoveData,
    [switch]$RemoveImages,
    [switch]$StopDockerDesktop
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dockerEnvPath = Join-Path $projectRoot '.env.docker'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker no esta instalado o no esta disponible en PATH.'
}

$composeArguments = @('compose')
if (Test-Path -LiteralPath $dockerEnvPath) {
    $composeArguments += @('--env-file', $dockerEnvPath)
}
$composeArguments += 'down'
if ($RemoveData) {
    $composeArguments += '--volumes'
}
if ($RemoveImages) {
    $composeArguments += @('--rmi', 'local')
}

Push-Location $projectRoot
try {
    & docker @composeArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose no pudo detener el sistema.'
    }
} finally {
    Pop-Location
}

$removed = @()
if ($RemoveData) { $removed += 'el volumen PostgreSQL' }
if ($RemoveImages) { $removed += 'las imagenes locales del prototipo' }

if ($removed.Count -gt 0) {
    Write-Host ("Sistema detenido y eliminado: " + ($removed -join ' y ') + '.') -ForegroundColor Yellow
} else {
    Write-Host 'Sistema detenido. Los datos PostgreSQL y las imagenes se conservan.' -ForegroundColor Green
}

if ($StopDockerDesktop) {
    & docker desktop stop
    if ($LASTEXITCODE -ne 0) {
        throw 'El sistema se detuvo, pero Docker Desktop no pudo cerrarse automáticamente.'
    }
    Write-Host 'Docker Desktop detenido.'
}
