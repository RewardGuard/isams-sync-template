# Instala isams-sync en una copia PRIVADA tuya (Windows PowerShell).
# Pide tus datos de iSAMS y guarda la contrasena solo como secreto cifrado de GitHub.
# Si falta GitHub CLI, lo instala; si no has iniciado sesion en GitHub, abre el navegador.
$ErrorActionPreference = "Continue"
$Template = if ($env:ISAMS_TEMPLATE) { $env:ISAMS_TEMPLATE } else { "RewardGuard/isams-sync-template" }

function Fail($msg) { Write-Host $msg -ForegroundColor Red; return }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Instalando GitHub CLI (puede pedir permiso)..."
    winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Fail "Instalado. Cierra esta ventana, abre PowerShell otra vez y pega el mismo comando."
        return
    }
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    $has = Read-Host "Tienes cuenta de GitHub? (s/n)"
    if ($has -match '^[nN]') {
        Write-Host "Se abrira github.com/signup. Crea tu cuenta, verifica tu correo y vuelve aqui."
        Start-Process "https://github.com/signup"
        Read-Host "Cuando tengas tu cuenta lista, presiona Enter"
    }
    Write-Host "Se abrira el navegador para iniciar sesion en GitHub."
    gh auth login --web --git-protocol https
    gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { Fail "No se pudo iniciar sesion en GitHub."; return }
}

$school = Read-Host "Subdominio de tu portal iSAMS (ej. 'miescuela' en https://miescuela.isamshosting.cloud)"
$user   = Read-Host "Usuario de iSAMS"
$name   = Read-Host "Nombre de tu repo privado [isams-sync]"
if (-not $name) { $name = "isams-sync" }

if (-not $school -or -not $user) { Fail "Faltan datos."; return }

$owner = gh api user --jq .login
$repo = "$owner/$name"

Write-Host "Creando $repo (PRIVADO)..."
gh repo create $repo --private --template $Template *> $null
for ($i = 0; $i -lt 6; $i++) { gh api "repos/$repo" *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 3 }

$priv = gh api "repos/$repo" --jq .private
if ($priv -ne "true") { Fail "El repo no es privado o no se pudo crear. Cancelo."; return }

gh secret set ISAMS_SCHOOL --repo $repo --body $school
gh secret set ISAMS_USER --repo $repo --body $user
Write-Host ""
Write-Host "Ahora pega tu contrasena de iSAMS cuando GitHub CLI la pida (no se muestra):"
gh secret set ISAMS_PASS --repo $repo
gh variable set ISAMS_ENABLED --body true --repo $repo

Write-Host "Lanzando la primera sincronizacion..."
Start-Sleep -Seconds 3
gh workflow run isams-sync --repo $repo
Write-Host ""
Write-Host "Listo. Mira el resultado en: https://github.com/$repo/actions"
Write-Host "Siguiente paso: README.md, seccion 'Dashboard con Claude'."
