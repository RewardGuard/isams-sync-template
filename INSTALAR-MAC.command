#!/bin/bash
# Doble clic para instalar en Mac. (Si macOS no lo deja abrir: clic derecho → Abrir.)
cd "$(dirname "$0")" || exit 1
bash instalar/instalar.sh
echo
read -r -p "Presiona Enter para cerrar esta ventana " _
