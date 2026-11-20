#!/usr/bin/env bash
# Instala isams-sync en una copia PRIVADA tuya. Pide usuario y contrasena de iSAMS
# y los guarda solo como secretos cifrados de GitHub (nunca en un archivo ni en pantalla).
set -euo pipefail

TEMPLATE="${ISAMS_TEMPLATE:-RewardGuard/isams-sync-template}"

if ! command -v gh >/dev/null; then
  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null; then
    echo "Instalando GitHub CLI con Homebrew..."; brew install gh
  else
    echo "Instala GitHub CLI primero (https://cli.github.com) y vuelve a pegar el comando."; exit 1
  fi
fi
if ! gh auth status >/dev/null 2>&1; then
  read -r -p "Tienes cuenta de GitHub? (s/n): " HAS
  if [[ "$HAS" =~ ^[nN] ]]; then
    echo "Se abrira github.com/signup. Crea tu cuenta, verifica tu correo y vuelve aqui."
    (open https://github.com/signup || xdg-open https://github.com/signup) >/dev/null 2>&1 || echo "Abre https://github.com/signup en tu navegador."
    read -r -p "Cuando tengas tu cuenta lista, presiona Enter " _
  fi
  echo "Se abrira el navegador para iniciar sesion en GitHub."
  gh auth login --web --git-protocol https
fi

read -r -p "Subdominio de tu portal iSAMS (ej. 'miescuela' en https://miescuela.isamshosting.cloud): " SCHOOL
read -r -p "Usuario de iSAMS: " IUSER
read -r -s -p "Contrasena de iSAMS (no se muestra): " IPASS; echo
read -r -p "Nombre de tu repo privado [isams-sync]: " NAME; NAME="${NAME:-isams-sync}"

[[ -n "$SCHOOL" && -n "$IUSER" && -n "$IPASS" ]] || { echo "Faltan datos."; exit 1; }

OWNER="$(gh api user --jq .login)"
REPO="$OWNER/$NAME"

echo "Creando $REPO (PRIVADO)..."
gh repo create "$REPO" --private --template "$TEMPLATE" >/dev/null

# La copia desde la plantilla puede tardar unos segundos en estar lista.
for i in 1 2 3 4 5 6; do gh api "repos/$REPO" >/dev/null 2>&1 && break; sleep 3; done

# Verifica que de verdad sea privado antes de guardar nada sensible.
[ "$(gh api "repos/$REPO" --jq .private)" = "true" ] || { echo "El repo no es privado. Cancelo."; exit 1; }

# Los valores van por stdin, no en la linea de comandos.
printf '%s' "$SCHOOL" | gh secret set ISAMS_SCHOOL --repo "$REPO"
printf '%s' "$IUSER"  | gh secret set ISAMS_USER --repo "$REPO"
printf '%s' "$IPASS"  | gh secret set ISAMS_PASS --repo "$REPO"
unset IPASS
gh variable set ISAMS_ENABLED --body true --repo "$REPO"

echo "Lanzando la primera sincronizacion..."
sleep 3
gh workflow run isams-sync --repo "$REPO" || echo "Si falla, corre el workflow a mano desde la pestana Actions."
echo
echo "Listo. Mira el resultado en: https://github.com/$REPO/actions"
echo "Siguiente paso: abre README.md, seccion 'Dashboard con Claude', y pega el prompt."
