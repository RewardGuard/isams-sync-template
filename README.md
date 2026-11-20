# isams-sync

Baja tus calificaciones, gradebooks y reportes de conducta del portal de estudiantes **iSAMS (cloud)** cada 4 horas, los guarda en **tu propio repo privado** y te avisa con un Issue de GitHub cuando algo baja. Con un prompt para Claude puedes armar encima un dashboard y una tarea diaria que prepara borradores de correo para tus maestros.

Todo corre en GitHub Actions (en la nube): no depende de tu computadora.

> **English, short version:** a GitHub Actions job logs into the iSAMS student portal every 4 hours, stores grades and conduct records in your own *private* repo, and opens an Issue when something drops. `setup.sh` asks for your portal subdomain, username and password (it finds your student ID by itself), and stores them only as encrypted GitHub secrets. Then paste the prompt from [`PROMPT_CLAUDE.md`](PROMPT_CLAUDE.md) into Claude to build a dashboard.

## Antes de empezar (importante)

- **Tu repo debe ser privado.** Guarda calificaciones y conducta, que pueden ser de un menor. Este repo (la plantilla) es público, pero **tu copia** no lo es: `setup.sh` la crea privada y el workflow se niega a correr si detecta que es pública. No hagas fork público ni cambies tu copia a pública.
- **Reglas de tu escuela.** Entrar con un programa a tu cuenta puede ir contra el reglamento de uso de tecnología de tu escuela o contra los términos de iSAMS. Revísalo y úsalo bajo tu propia responsabilidad. Este proyecto no está afiliado a iSAMS ni a ninguna escuela.
- **Solo está probado con un colegio** (iSAMS cloud con inicio de sesión OpenID Connect). Si tu portal tiene otra dirección o flujo, puede necesitar ajustes. Si lo adaptas, cuéntalo en un Issue.
- **Tu contraseña** solo se guarda como secreto cifrado de GitHub en tu repo. No se imprime ni se escribe en archivos. Si alguna vez la pegas en un chat o la ves en pantalla, cámbiala.

## Instalación en 2 pasos

**Paso 1. Pega un comando en la terminal.** Te pregunta si ya tienes cuenta de GitHub; si no, abre la página para crearla, y luego te pide el subdominio de tu portal, tu usuario y tu contraseña de iSAMS (no se muestra). Crea tu copia **privada**, guarda las credenciales cifradas y lanza la primera sincronización. Tu ID de estudiante lo busca solo.

**Windows** (abre *PowerShell*, no CMD):

```powershell
irm https://raw.githubusercontent.com/RewardGuard/isams-sync-template/main/setup.ps1 | iex
```

**Mac** (abre *Terminal*):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/RewardGuard/isams-sync-template/main/setup.sh)
```

Tu subdominio es la primera parte de la dirección de tu portal: en `https://miescuela.isamshosting.cloud`, es `miescuela`. Lee los scripts antes de correrlos ([`setup.ps1`](setup.ps1), [`setup.sh`](setup.sh)): son cortos. En Linux instala antes [GitHub CLI](https://cli.github.com) y usa el comando de Mac.

**Paso 2. Pega el prompt en Claude.** Abre [`PROMPT_CLAUDE.md`](PROMPT_CLAUDE.md), copia el prompt (cambia `TU_USUARIO` por tu usuario de GitHub) y pégalo en Claude con los conectores de GitHub y Gmail activados. Claude arma tu dashboard y la tarea diaria.

Si el comando no encuentra tu ID de estudiante solo, define el secreto `ISAMS_STUDENT_ID` en tu repo: es el número que aparece en `/markbooks/students/<número>` en la pestaña Red/Network de tu navegador (F12) al abrir tus calificaciones.

### Revisa que funcionó

Abre `https://github.com/TU_USUARIO/isams-sync/actions`. Si todo salió bien, aparece un commit con `data/latest.json`. Si falla en el login, revisa usuario, contraseña y subdominio (`Settings → Secrets and variables → Actions`).

## Dashboard con Claude

Abre [`PROMPT_CLAUDE.md`](PROMPT_CLAUDE.md), copia el prompt, pégalo en Claude (con los conectores de GitHub y Gmail activados) y responde sus preguntas. Claude arma el dashboard y una tarea diaria. Los correos a maestros quedan solo como **borradores**: nada se envía sin que tú lo envíes.

## Qué guarda

`data/latest.json` (calificaciones por materia y por trabajo, conducta) y `data/changes.log` (qué cambió en cada corrida). Se considera negativo: un total que baja 1 punto o más, una nota nueva menor a 60, una nota que baja, o un reporte de conducta nuevo. Puedes cambiar los umbrales con las variables `ISAMS_DROP` y `ISAMS_LOW`.

## Licencia

MIT. Úsalo, cámbialo y compártelo.
