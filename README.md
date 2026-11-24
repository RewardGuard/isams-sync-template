# isams-sync

Tus calificaciones de **iSAMS** en un dashboard que se actualiza solo, con alertas por correo cuando algo baja, tus tareas de **Google Classroom**, y una tarea diaria de **Claude** que te arma la lista de pendientes, resuelve paso a paso las hojas de ejercicios y te deja borradores de correo para tus maestros (nunca los envía).

Todo corre en la nube con **tus** cuentas: nada pasa por servidores de otra persona.

## Instalación (3 pasos, ~15 minutos)

### 1. Descarga el ZIP

**[⬇ Descargar isams-sync (ZIP)](https://github.com/RewardGuard/isams-sync-template/archive/refs/heads/main.zip)** y descomprímelo en tu carpeta de Descargas.

- **Mac:** doble clic en el ZIP (Safari ya lo descomprime solo).
- **Windows:** clic derecho en el ZIP → **Extraer todo…** → Extraer.

### 2. Pega un comando

**Mac** — abre la app **Terminal** y pega:

```bash
bash "$(find ~/Downloads ~/Desktop -path '*isams-sync*/instalar/instalar.sh' 2>/dev/null | head -1)"
```

**Windows** — abre **PowerShell** (búscalo en Inicio) y pega:

```powershell
$f = Get-ChildItem "$HOME\Downloads","$HOME\Desktop" -Recurse -Filter instalar.ps1 -ErrorAction SilentlyContinue | Where-Object FullName -like '*isams-sync*' | Select-Object -First 1; powershell -NoProfile -ExecutionPolicy Bypass -File $f.FullName
```

¿Prefieres no usar la terminal? Abre la carpeta y haz doble clic en **`INSTALAR-WINDOWS.bat`** o **`INSTALAR-MAC.command`** (en Mac, si dice que no se puede abrir: clic derecho → Abrir).

El instalador te va preguntando todo y te dice qué hacer en el navegador:

1. Instala lo que haga falta (Node.js, GitHub CLI y clasp) en una carpeta tuya, sin permisos de administrador.
2. **GitHub:** inicias sesión (o creas tu cuenta gratis), crea tu copia **privada** del proyecto y guarda tu usuario y contraseña de iSAMS como secretos cifrados.
3. **Google (cuenta personal):** activas un interruptor ("API de Google Apps Script"), le das permiso a clasp, y el instalador crea tu hoja de calificaciones con su script. Tú corres `instalar` una vez en el editor para darle permisos.
4. Conecta GitHub con tu hoja con una clave que genera ahí mismo (no la tienes que copiar).
5. Corre la primera sincronización y te dice si entró bien a iSAMS (si el usuario o la contraseña están mal, te los vuelve a pedir).
6. **Classroom (opcional, cuenta de la escuela):** lo mismo, con tu cuenta de la escuela; corres `instalarReloj` una vez.
7. Revisa que todo quedó guardado en la hoja.
8. Te deja el prompt para Claude copiado en el portapapeles (y en `MI_PROMPT_PARA_CLAUDE.txt`).

Si algo falla, vuelve a pegar el mismo comando: **retoma donde se quedó**.

### 3. Pega el prompt en Claude

En [claude.ai](https://claude.ai) activa los conectores de **Google Drive / Sheets** (con la cuenta personal, dueña de la hoja) y de **Gmail**, abre un chat nuevo y pega el prompt (Cmd+V / Ctrl+V). Claude te pregunta por tus maestros y tus materias, y deja:

- un **dashboard** en vivo (GPA estimado, ceros y cuánto subirías si los entregas, pendientes, soluciones paso a paso, conducta, historial). En **Pendientes**, el botón **Hacer con IA** lee la tarea y los archivos del maestro y Claude la hace ahí mismo (la primera vez te pide permiso para usar Claude; gasta de tu uso como un mensaje normal). Las tareas donde el maestro pidió no usar IA no tienen botón,
- una **tarea diaria** (6:41 y 15:41) que actualiza pendientes, resuelve hojas de ejercicios y deja borradores para tus maestros.

## Qué necesitas

- Una computadora **Mac o Windows** (solo para instalar; después todo corre en la nube).
- Tu usuario y contraseña del portal de estudiantes de **iSAMS** (el que se ve como `https://miescuela.isamshosting.cloud`).
- Una cuenta de **GitHub** (gratis; el instalador te ayuda a crearla).
- Una cuenta de **Google personal** (Gmail).
- Opcional: tu cuenta de Google **de la escuela** (la de Classroom).
- **Claude** con conectores y tareas programadas para el paso 3.

## Antes de usarlo (importante)

- **Úsalo solo con tu propia cuenta.** Revisa que el reglamento de tu escuela permita leer tu portal con un programa. Este proyecto no está afiliado a iSAMS, a Google ni a ninguna escuela.
- **Tus datos son privados.** Tu copia en GitHub es privada (el instalador la crea así y el proceso se niega a correr si alguien la hace pública) y la hoja es de tu cuenta. No hagas fork público.
- **Contraseñas:** las escribes tú en la terminal (no se ven) y quedan solo como secretos cifrados de GitHub. Si alguna vez la pegas en un chat, cámbiala.
- **Lo que hace la IA:** nunca envía correos (solo borradores), no hace ensayos ni reflexiones personales, y respeta cuando un maestro pide **no usar IA**. Las soluciones de ejercicios se comprueban con cálculo, pero revísalas: en el examen lo vas a hacer tú.
- Está probado con una escuela (iSAMS cloud con inicio de sesión OpenID Connect y horario de México). Si tu portal es distinto puede necesitar ajustes: abre un Issue.

## Cómo funciona

```
iSAMS ──(GitHub Actions, cada hora)──► tu hoja de Google ◄──(script, cada hora)── Classroom (cuenta escuela)
                                         │   └─ vigilante: alertas por correo, relanza si se atrasa,
                                         │      compara calificaciones de Classroom contra iSAMS
                                         ▼
                         dashboard (artifact de Claude)  +  tarea diaria de Claude (pendientes,
                                                            soluciones, borradores para maestros)
```

| Pieza | Dónde vive | Archivo |
|---|---|---|
| Sincronización con iSAMS (login, extracción, validación) | GitHub Actions de tu repo privado | `sync.py`, `isams/`, `isams_client.py` |
| Hoja + receptor firmado (HMAC) + vigilante | Apps Script de tu cuenta personal | `apps_script/hoja/` |
| Lectura de Classroom (solo lectura) | Apps Script de tu cuenta de la escuela | `apps_script/classroom/` |
| Dashboard | Artifact de Claude | `dashboard/index.html` |
| Tarea diaria | Tarea programada de Claude | `claude/capa_ia.txt` |
| Instalador | Tu computadora (una vez) | `instalar/` |

Ajustes opcionales (en tu repo → Settings → Secrets and variables → Actions → Variables): `ISAMS_NO_GPA` (materias que no cuentan para el GPA, por defecto talleres "WS "), `ISAMS_AVANZADAS` (+1 en GPA ponderado, por defecto "ADV"), `ISAMS_EXPECT_NAME` (tu primer nombre, para rechazar datos de otra persona).

## Problemas comunes

- **"Login rechazado" en la primera sincronización:** usuario o contraseña de iSAMS mal escritos; el instalador te los vuelve a pedir.
- **No encuentra tu ID de estudiante:** abre tus calificaciones en el portal, presiona F12 → Red/Network, busca una dirección `/markbooks/students/<número>` y dale ese número al instalador.
- **"User has not enabled the Apps Script API":** falta el interruptor de https://script.google.com/home/usersettings en esa cuenta.
- **Google dice que el acceso está bloqueado (cuenta de la escuela):** tu escuela no deja usar clasp. Instala Classroom a mano (abajo).
- **Llegó un correo "la sincronización necesita atención":** abre tu repo → Actions para ver el error, o pídele a Claude que lo revise.

### Classroom a mano (si tu escuela bloquea clasp)

1. Con tu cuenta de la escuela abre https://script.new y ponle de nombre "Classroom → calificaciones".
2. Engrane (Configuración del proyecto) → marca **Mostrar el archivo de manifiesto "appsscript.json"**.
3. Pega `apps_script/classroom/appsscript.json` en `appsscript.json` y `apps_script/classroom/Classroom.gs` en `Código.gs`.
4. Agrega un archivo de script `Config` con: `var CONFIG = {SHEET_ID: 'EL_ID_DE_TU_HOJA'};` (el instalador te dio el id; es lo que va entre `/d/` y `/edit` en el link de tu hoja).
5. Guarda, elige `instalarReloj` y presiona Ejecutar; acepta los permisos.

## Mi letra: tu letra para tus notas

Una página aparte, en la carpeta `mi_letra/`, para hacer una fuente con tu propia letra y escribir tus notas con ella. No usa IA, Classroom ni tu hoja, y funciona sin internet: todo pasa en tu navegador y tu foto no se sube a ningún lado.

1. Abre `mi_letra/index.html` (doble clic, desde la carpeta del ZIP) en Chrome, Edge, Safari o Firefox.
2. Imprime la plantilla (hoja carta; en A4 elige "ajustar a la página") y llénala a mano con pluma oscura.
3. Sube una foto. La página encuentra los cuatro cuadros negros, endereza la hoja y lee cada letra. Si no los encuentra, puedes marcarlos a mano.
4. Revisa tus letras y descarga tu fuente `.otf` (la puedes instalar en tu computadora).
5. Escribe o pega tus notas y míralas con tu letra, en renglón, cuadrícula o hoja blanca; también las puedes imprimir.

Tu fuente y tus notas se guardan solo en tu navegador. La fuente se arma con [opentype.js](https://github.com/opentypejs/opentype.js) (licencia MIT, incluida en `mi_letra/opentype.LICENSE`).

## Desinstalar

Borra tu repo privado en GitHub, la hoja y los dos scripts en https://script.google.com, la tarea programada y el artifact en Claude, y la carpeta de herramientas (`~/.isams-sync` en Mac, `%LOCALAPPDATA%\isams-sync` en Windows).

## Licencia

MIT. Úsalo, cámbialo y compártelo.
