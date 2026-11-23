# Instalador para Windows. Solo se asegura de que haya Node.js 20+ y lanza instalar.mjs, que hace todo lo demas.
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File instalar\instalar.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$herr = Join-Path $env:LOCALAPPDATA 'isams-sync'
$nodeVersion = '22.11.0'

function Test-NodeOk([string]$exe) {
  $ErrorActionPreference = 'Continue'
  try {
    $v = & $exe -p "process.versions.node.split('.')[0]" 2>&1 | Select-Object -First 1
    return ([int]"$v" -ge 20)
  } catch { return $false }
}

$node = $null
$sistema = Get-Command node -ErrorAction SilentlyContinue
$portable = Join-Path $herr 'node\node.exe'
if ($sistema -and (Test-NodeOk $sistema.Source)) {
  $node = $sistema.Source
} elseif ((Test-Path $portable) -and (Test-NodeOk $portable)) {
  $node = $portable
} else {
  $arq = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arq = 'arm64' }
  $nombre = "node-v$nodeVersion-win-$arq"
  Write-Host "Descargando Node.js $nodeVersion en $herr (una sola vez, ~30 MB)..."
  New-Item -ItemType Directory -Force -Path $herr | Out-Null
  $zip = Join-Path $herr 'node.zip'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$nombre.zip" -OutFile $zip
  $destino = Join-Path $herr 'node'
  if (Test-Path $destino) { Remove-Item -Recurse -Force $destino }
  $extraido = Join-Path $herr $nombre
  if (Test-Path $extraido) { Remove-Item -Recurse -Force $extraido }
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & tar.exe -xf $zip -C $herr 2>&1 | Out-Null } catch { }
  $ErrorActionPreference = $antes
  if (-not (Test-Path $extraido)) { Expand-Archive -Path $zip -DestinationPath $herr -Force }
  Rename-Item -Path $extraido -NewName 'node'
  Remove-Item -Force $zip
  $node = $portable
}

$env:Path = (Split-Path -Parent $node) + ';' + $env:Path
& $node (Join-Path $aqui 'instalar.mjs') @args
exit $LASTEXITCODE
