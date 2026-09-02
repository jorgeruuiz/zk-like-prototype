[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$NoBrowser,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dockerEnvPath = Join-Path $projectRoot '.env.docker'

function Test-DockerEngine {
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker info --format '{{.ServerVersion}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Get-AppPort {
    if (-not (Test-Path -LiteralPath $dockerEnvPath)) {
        return 3000
    }

    $match = Get-Content -LiteralPath $dockerEnvPath -Encoding UTF8 |
        Where-Object { $_ -match '^\s*APP_PORT\s*=\s*(\d+)\s*$' } |
        Select-Object -Last 1

    if ($match -and $match -match '^\s*APP_PORT\s*=\s*(\d+)\s*$') {
        return [int]$Matches[1]
    }

    return 3000
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker no esta instalado o no esta disponible en PATH.'
}

if (-not (Test-DockerEngine)) {
    Write-Host 'Iniciando Docker Desktop...'

    $desktopStarted = $false
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker desktop start *> $null
        $desktopStarted = $LASTEXITCODE -eq 0
    } catch {
        $desktopStarted = $false
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    if (-not $desktopStarted) {
        $desktopPath = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $desktopPath)) {
            throw 'No se pudo iniciar Docker Desktop. Abrelo manualmente y vuelve a ejecutar el script.'
        }
        Start-Process -FilePath $desktopPath -WindowStyle Hidden
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-DockerEngine)) {
        if ((Get-Date) -ge $deadline) {
            throw "Docker Desktop no quedó disponible en ${TimeoutSeconds} segundos."
        }
        Start-Sleep -Seconds 2
    }
}

$composePrefix = @('compose')
if (Test-Path -LiteralPath $dockerEnvPath) {
    Write-Host 'Usando variables de .env.docker'
    $composePrefix += @('--env-file', $dockerEnvPath)
} else {
    Write-Host 'No existe .env.docker; se usaran los valores de demostracion de compose.yaml.'
}

$upArguments = @($composePrefix + 'up')
if (-not $NoBuild) {
    $upArguments += '--build'
}
$upArguments += '-d'

Push-Location $projectRoot
try {
    & docker @upArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose no pudo iniciar el sistema.'
    }

    $port = Get-AppPort
    $healthUrl = "http://127.0.0.1:$port/api/health"
    $appUrl = "http://localhost:$port"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    Write-Host 'Esperando a que la aplicacion este saludable...'
    while ($true) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
            if ($health.status -eq 'ok') {
                break
            }
        } catch {
            # El servidor o PostgreSQL todavia pueden estar arrancando.
        }

        if ((Get-Date) -ge $deadline) {
            & docker @composePrefix ps -a
            & docker @composePrefix logs --no-color --tail 80 app db-init
            throw "La aplicación no quedó saludable en ${TimeoutSeconds} segundos."
        }
        Start-Sleep -Seconds 2
    }

    Write-Host ''
    Write-Host 'Sistema ZKP iniciado correctamente.' -ForegroundColor Green
    Write-Host "Aplicacion: $appUrl"
    Write-Host 'Estado:     docker compose ps'
    Write-Host 'Logs:       docker compose logs -f app'
    Write-Host 'Parada:     .\scripts\stop-docker.ps1'

    if (-not $NoBrowser) {
        Start-Process $appUrl
    }
} finally {
    Pop-Location
}
