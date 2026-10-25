# worktree-diff

Un mod de Claude Code que pone sobre el prompt los archivos que cambiaron en el worktree de la sesión. Al hacer clic en uno se abre un panel con su diff y un editor.

```text
[README.md] +1 -1 [PRUEBA.md] +4 [.env] click para ver o editar     ← clic: abre el panel con ese archivo
──────────────────────────────────────────────────────────────────
❯
```

- **Fila sobre el prompt**: un `[archivo]` por cada archivo cambiado (`git status`), con sus líneas agregadas y quitadas. Se ilumina al pasar el puntero y queda marcado el que está abierto.
- **El panel no se abre solo**: solo aparece al elegir un archivo (o con `/worktree`). Se cierra con **✕**.
- **Diff**: los cambios del archivo con colores.
- **Editar**: el archivo con números de línea. Haz clic en una línea para editarla y pulsa Enter para guardar. También puedes borrar la línea o agregar una al final. En archivos de más de 800 líneas solo se puede ver; para editarlos usa *Abrir fuera*.
- **Variables de entorno**: también aparecen `.env`, `.env.*` y `.dev.vars` de la raíz del repo, aunque estén en `.gitignore`. Los valores se ven ocultos hasta pulsar *Mostrar valores*, y se pueden editar, borrar o agregar uno por uno.
- **Abrir fuera ↗**: abre el archivo con tu editor externo (configurable).
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

## Desarrollo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
