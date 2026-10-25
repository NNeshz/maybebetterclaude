# worktree-diff

Un mod de Claude Code que abre un panel al lado del chat con los cambios del worktree de la sesión.

- Lista los archivos cambiados (`git status`) con las líneas agregadas y quitadas de cada uno, y el total.
- Al hacer clic en un archivo muestra su diff con colores.
- **Editar aquí**: un editor integrado en el panel para cambiar el archivo sin salir de Claude Code.
- **Variables de entorno**: detecta `.env`, `.env.*` y `.dev.vars` en la raíz del repo (aunque estén en `.gitignore`). Los valores salen ocultos hasta que pulsas *Mostrar valores*; entonces puedes editar, borrar o agregar variables una por una.
- **Abrir fuera ↗**: abre el archivo con tu editor externo (configurable).
- Si la sesión no está dentro de un repositorio git, ofrece elegir uno de las subcarpetas.
- Usa los colores del tema de Claude Code (`/theme`) y se puede usar con teclado o con mouse.

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

- El panel se abre solo al iniciar la sesión si la terminal tiene al menos 144 columnas.
- `/worktree` lo abre (o lo reabre) en cualquier momento.
- Los cambios se refrescan solos después de cada `Edit`, `Write` o `Bash` de Claude, o con **↻ Refrescar**.

## Configuración

Opción **Editor externo** (en `/config`): el comando que abre un archivo; se le agrega la ruta al final. Por defecto `open` (la app predeterminada de macOS). Ejemplos: `open -a Warp`, `code -g`, `zed`, `cursor`.

## Desarrollo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
