# worktree-diff

Un mod de Claude Code que pone sobre el prompt los archivos que cambiaron en el worktree de la sesión. Al hacer clic en uno se abre un panel con su diff y un editor.

```text
⎇ 23 cambios +412 -88 │ [README.md] +2 [register.tsx] +210 -60 [pane.test.tsx] +15 -5 +20 más
──────────────────────────────────────────────────────────────────
❯
```

- **Fila sobre el prompt**: siempre ocupa una sola línea. Empieza con un resumen (`⎇ 23 cambios +412 -88`) que abre la lista de todos los archivos cambiados, sigue con un `[archivo]` por cada uno que quepa y termina con `+N más`.
- **Lista de cambios**: como el panel de Source Control de Cursor: nombre, carpeta en gris, líneas agregadas y quitadas, y la letra de estado (M, U, A, D). Clic en uno para abrirlo; `‹` vuelve a la lista. `/worktree` la abre. El panel se cierra con **✕**.
- **Otros worktrees**: debajo de los archivos, la lista muestra los demás worktrees del mismo repo (`git worktree list`), sin el actual ni los marcados como *prunable*: la rama, la carpeta en gris, cuántos archivos cambiaron y sus líneas +/−. Clic en uno para desplegar sus archivos; clic en un archivo para verlo en el panel en solo lectura (pestañas *Código* y *Cambios*, sin *Editar*), con la ruta `⎇ rama › carpeta › archivo`. Se listan hasta 20 worktrees y 50 archivos por worktree; el resto se cuenta como `+N más`. Se calcula solo mientras la lista está abierta, y se refresca con los mismos disparadores que el resto. La fila sobre el prompt sigue mostrando solo el worktree actual.
- **Código**: el archivo con ruta de navegación (`carpeta › archivo › # sección`), números de línea, resaltado de sintaxis (Markdown y código) y una marca en el margen en cada línea agregada (verde), modificada (azul) o borrada (rojo). Se desplaza con la rueda; solo dibuja lo que se ve, así que sirve para archivos de cualquier tamaño.
- **Editar**: un editor como el de Warp, dentro del panel: números de línea, colores, marcas de cambios, cursor y barra de estado (`Ln 12, Col 4 · ✓ guardado`). Haz clic en el texto para escribir; flechas, Inicio/Fin, Re Pág/Av Pág, Tab, Enter conserva la sangría. Con *Autoguardado* encendido se guarda solo al dejar de escribir; `ctrl+s` guarda al momento; Esc devuelve el teclado al prompt.
- **Pestañas**: *Preview* y *Markdown* en archivos `.md`, *Código* en el resto, *Editar*, y *Cambios* con el diff a colores.
- **Variables de entorno**: también aparecen `.env`, `.env.*` y `.dev.vars` de la raíz del repo, aunque estén en `.gitignore`. Los valores se ven ocultos hasta pulsar *Mostrar valores*. Por defecto solo se ven: para editar, borrar o agregar variables hay que encender *Editar variables de entorno* en `/config`; entonces cada guardado pide confirmación en el panel (`¿Guardar cambios en .env? (y/n)`, o los botones *Sí* / *No*), y el autoguardado nunca aplica a estos archivos.
- **↗**: abre el archivo con tu editor externo (configurable).
- El panel tiene un fondo más oscuro que la terminal (configurable). Se puede usar con teclado o con mouse.

## Instalación

En una sesión de Claude Code en la terminal:

```
/plugin install worktree-diff --marketplace NNeshz/maybebetterclaude
```

Responde `y` para agregar el marketplace y elige el alcance (usuario, recomendado).

Desde una shell:

```
claude plugin install worktree-diff --marketplace NNeshz/maybebetterclaude
```

En la app de escritorio: haz clic en + junto a la caja del prompt, luego Plugins, Add marketplace con `NNeshz/maybebetterclaude`, y después Add plugin.

## Uso

- La fila de archivos aparece sobre el prompt cuando el worktree tiene cambios. Para hacer clic en ella hace falta el modo pantalla completa (`"tui": "fullscreen"`); sin mouse, ctrl+x tab lleva el foco a la fila.
- `/worktree` abre el primer archivo cambiado.
- Los cambios se refrescan solos después de cada `Edit`, `Write` o `Bash` de Claude.

## Configuración

En `/config`:

- **Editor externo**: el comando que abre un archivo, al que se le agrega la ruta al final. Por defecto es `open` (la app predeterminada de macOS). Ejemplos: `open -a Warp`, `code -g`, `zed`, `cursor`.
- **Fondo del panel**: el color de fondo del panel. Por defecto es `#0a0a0a`. Si lo dejas vacío, usa el fondo de la terminal (útil con un tema claro).
- **Editar variables de entorno**: apagado por defecto. Apagado, `.env`, `.env.*` y `.dev.vars` se listan y se ven (con los valores ocultos hasta pulsar *Mostrar valores*), pero no se pueden editar, borrar ni agregar variables, y el panel lo avisa. Encendido, cada guardado en un archivo de entorno pide confirmación explícita en el panel, y el autoguardado no aplica a ellos aunque esté activado.

## Desarrollo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
