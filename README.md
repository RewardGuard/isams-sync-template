# isams-sync

Baja tus calificaciones, gradebooks y reportes de conducta del portal de estudiantes **iSAMS (cloud)** cada 4 horas, los guarda en **tu propio repo privado** y te avisa con un Issue de GitHub cuando algo baja. Con un prompt para Claude puedes armar encima un dashboard y una tarea diaria que prepara borradores de correo para tus maestros.

Todo corre en GitHub Actions (en la nube): no depende de tu computadora.

> **English, short version:** a GitHub Actions job logs into the iSAMS student portal every 4 hours, stores grades and conduct records in your own *private* repo, and opens an Issue when something drops. `setup.sh` asks for your portal subdomain, student ID, username and password, and stores them only as encrypted GitHub secrets. Then paste the prompt from [`PROMPT_CLAUDE.md`](PROMPT_CLAUDE.md) into Claude to build a dashboard.

## Antes de empezar (importante)

- **Tu repo debe ser privado.** Guarda calificaciones y conducta, que pueden ser de un menor. Este repo (la plantilla) es público, pero **tu copia** no lo es: `setup.sh` la crea privada y el workflow se niega a correr si detecta que es pública. No hagas fork público ni cambies tu copia a pública.
- **Reglas de tu escuela.** Entrar con un programa a tu cuenta puede ir contra el reglamento de uso de tecnología de tu escuela o contra los términos de iSAMS. Revísalo y úsalo bajo tu propia responsabilidad. Este proyecto no está afiliado a iSAMS ni a ninguna escuela.
- **Solo está probado con un colegio** (iSAMS cloud con inicio de sesión OpenID Connect). Si tu portal tiene otra dirección o flujo, puede necesitar ajustes. Si lo adaptas, cuéntalo en un Issue.
- **Tu contraseña** solo se guarda como secreto cifrado de GitHub en tu repo. No se imprime ni se escribe en archivos. Si alguna vez la pegas en un chat o la ves en pantalla, cámbiala.

## Instalación (un comando)

Necesitas una cuenta de GitHub y la [GitHub CLI](https://cli.github.com) con sesión iniciada (`gh auth login`).

### 1. Encuentra tu ID de estudiante

1. Entra a tu portal de iSAMS en el navegador e inicia sesión.
2. Abre las herramientas de desarrollador (F12) y ve a la pestaña **Red / Network**.
3. Abre la sección de calificaciones y filtra por `markbooks/students/`.
4. En la dirección de esa petición verás `/markbooks/students/` seguido de un número. Ese número es tu ID.

Tu subdominio es la primera parte de la dirección de tu portal: en `https://miescuela.isamshosting.cloud`, es `miescuela`.

### 2. Pega esto en tu terminal

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/RewardGuard/isams-sync-template/main/setup.sh)
```

Lee el script antes si quieres ([`setup.sh`](setup.sh)): son unas 45 líneas. Te pregunta el subdominio, tu ID, usuario y contraseña (la contraseña no se muestra), crea tu copia **privada**, guarda los secretos y lanza la primera sincronización.

### 3. Revisa que funcionó

Abre `https://github.com/TU_USUARIO/isams-sync/actions`. Si todo salió bien, aparece un commit con `data/latest.json`. Si falla en el login, revisa usuario, contraseña y subdominio (`Settings → Secrets and variables → Actions`).

## Dashboard con Claude

Abre [`PROMPT_CLAUDE.md`](PROMPT_CLAUDE.md), copia el prompt, pégalo en Claude (con los conectores de GitHub y Gmail activados) y responde sus preguntas. Claude arma el dashboard y una tarea diaria. Los correos a maestros quedan solo como **borradores**: nada se envía sin que tú lo envíes.

## Qué guarda

`data/latest.json` (calificaciones por materia y por trabajo, conducta) y `data/changes.log` (qué cambió en cada corrida). Se considera negativo: un total que baja 1 punto o más, una nota nueva menor a 60, una nota que baja, o un reporte de conducta nuevo. Puedes cambiar los umbrales con las variables `ISAMS_DROP` y `ISAMS_LOW`.

## Licencia

MIT. Úsalo, cámbialo y compártelo.
