import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Change, Opened, Snapshot, View } from '../types'

const PANE = 'worktree-diff'
const EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
const MAX_DIFF = 90000
// Past this many lines the editor shows the file read-only and points to "Abrir fuera".
const MAX_EDIT_LINES = 800
// Chips in the band above the prompt; the rest are counted.
const MAX_CHIPS = 12

const shown = atom({ plugin: 'worktree-diff', key: 'shown' } as const, null as View | null)
const snapshot = atom({ plugin: 'worktree-diff', key: 'snapshot' } as const, {
  root: '',
  branch: '',
  changes: [],
  envFiles: [],
} as Snapshot)
const opened = atom({ plugin: 'worktree-diff', key: 'opened' } as const, null as Opened | null)
const reveal = atom({ plugin: 'worktree-diff', key: 'reveal' } as const, false)
const notice = atom({ plugin: 'worktree-diff', key: 'notice' } as const, '')
// The line being edited in the editor, by index; null edits none.
const line = atom({ plugin: 'worktree-diff', key: 'line' } as const, null as number | null)

const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/
const isEnvFile = (name: string) => /^\.env(\..+)?$/.test(name) || name === '.dev.vars'
const baseName = (path: string) => path.split('/').pop() ?? path

// git status --porcelain=v1 -z: "XY path\0", a rename followed by "orig\0".
const parseStatus = (raw: string): Change[] => {
  const parts = raw.split('\0')
  const changes: Change[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    changes.push({ path: entry.slice(3), code })
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return changes
}

const MAX_COUNTED = 50

// git diff --numstat: "added\tremoved\tpath", "-\t-\tpath" for a binary file.
const parseNumstat = (raw: string) => {
  const counts = new Map<string, { added?: number; removed?: number; isBinary?: boolean }>()
  for (const row of raw.split('\n')) {
    const [added, removed, path] = row.split('\t')
    if (added === undefined || removed === undefined || path === undefined) continue
    counts.set(
      path,
      added === '-' ? { isBinary: true } : { added: Number(added), removed: Number(removed) },
    )
  }
  return counts
}

const countLines = (text: string) =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

const capDiff = (diff: string) => {
  if (diff.length <= MAX_DIFF) return diff
  const cut = diff.lastIndexOf('\n@@', MAX_DIFF)
  return cut > 0 ? diff.slice(0, cut + 1) : ''
}

const describe = (code: string) =>
  code === '??'
    ? 'nuevo'
    : code.includes('D')
      ? 'borrado'
      : code.includes('R')
        ? 'renombrado'
        : code.includes('A')
          ? 'agregado'
          : 'modificado'

const tone = (code: string) =>
  code === '??' || code.includes('A') ? 'success' : code.includes('D') ? 'error' : 'warning'

const git = ($: EngineInterface, root: string, args: string[]) =>
  $.process.run(['git', ...args], { cwd: root, timeoutMs: 15000 })

const loadFile = async ($: EngineInterface, path: string, withDiff: boolean) => {
  const { root, changes } = await read($, snapshot)
  const text = await $.fs.read(`${root}/${path}`).catch(() => '')
  let diff = ''
  if (withDiff) {
    const change = changes.find(one => one.path === path)
    const args =
      change?.code === '??'
        ? ['diff', '--no-color', '--no-index', '--', '/dev/null', path]
        : ['diff', '--no-color', 'HEAD', '--', path]
    const ran = await git($, root, args).catch(() => undefined)
    diff = capDiff(ran?.stdout ?? '')
  }
  await update($, opened, () => ({ path, text: typeof text === 'string' ? text : '', diff }))
}

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!top || top.exitCode !== 0) {
    await update($, snapshot, () => ({
      root: cwd,
      branch: '',
      changes: [],
      envFiles: [],
      error: 'Este directorio no es un repositorio git.',
    }))
    return
  }
  const root = top.stdout.trim()
  const [status, branch, entries, numstat] = await Promise.all([
    git($, root, ['status', '--porcelain=v1', '-z', '-uall']),
    git($, root, ['branch', '--show-current']),
    $.fs.list(root).catch(() => []),
    // Fails in a repository with no commit yet: every file then counts as new.
    git($, root, ['diff', '--numstat', '--no-renames', 'HEAD']).catch(() => undefined),
  ])
  const counts = parseNumstat(numstat?.exitCode === 0 ? numstat.stdout : '')
  const changes: Change[] = []
  let counted = 0
  for (const change of parseStatus(status.stdout)) {
    const known = counts.get(change.path)
    if (known) {
      changes.push({ ...change, ...known })
    } else if (change.code === '??' && counted < MAX_COUNTED) {
      counted++
      const text = await $.fs.read(`${root}/${change.path}`).catch(() => undefined)
      changes.push(
        typeof text === 'string' ? { ...change, added: countLines(text), removed: 0 } : change,
      )
    } else {
      changes.push(change)
    }
  }
  const envFiles = entries
    .filter(entry => entry.kind === 'file' && isEnvFile(entry.name))
    .map(entry => entry.name)
    .sort()
  await update($, snapshot, () => ({
    root,
    branch: branch.stdout.trim() || '(detached)',
    changes,
    envFiles,
  }))
  // The open file follows what Claude just changed in it.
  const current = await read($, shown)
  if (current) await loadFile($, current.path, current.kind === 'diff')
}

const go = async ($: EngineInterface, next: View) => {
  await update($, notice, () => '')
  await update($, line, () => null)
  await loadFile($, next.path, next.kind === 'diff')
  await update($, shown, () => next)
}

// A chip in the band, or /worktree: shows the file in the pane, opening it.
const openFile = async ($: EngineInterface, path: string) => {
  const isEnv = isEnvFile(baseName(path)) && !(await read($, snapshot)).changes.some(one => one.path === path)
  await go($, { kind: isEnv ? 'env' : 'diff', path })
  await $.ui.open({ id: PANE, title: baseName(path) })
}

const save = async ($: EngineInterface, path: string, text: string) => {
  const { root } = await read($, snapshot)
  await $.fs.write(`${root}/${path}`, text)
  await update($, opened, file => (file && file.path === path ? { ...file, text } : file))
  await update($, notice, () => `Guardado ${path}`)
  void refresh($)
}

const editLines = async ($: EngineInterface, path: string, edit: (lines: string[]) => void) => {
  const file = await read($, opened)
  if (!file || file.path !== path) return
  const lines = file.text.split('\n')
  edit(lines)
  await update($, line, () => null)
  await save($, path, lines.join('\n'))
}

const setEnv = async ($: EngineInterface, path: string, key: string, value: string) => {
  const file = await read($, opened)
  if (!file) return
  const lines = file.text.split('\n')
  const at = lines.findIndex(row => ENV_LINE.exec(row)?.[2] === key)
  if (at >= 0) {
    const [, lead, name, eq] = ENV_LINE.exec(lines[at] ?? '')!
    lines[at] = `${lead}${name}${eq}${value}`
  } else {
    const end = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    lines.splice(end, 0, `${key}=${value}`)
  }
  await save($, path, lines.join('\n'))
}

const removeEnv = async ($: EngineInterface, path: string, key: string) => {
  const file = await read($, opened)
  if (!file) return
  const lines = file.text.split('\n').filter(row => ENV_LINE.exec(row)?.[2] !== key)
  await save($, path, lines.join('\n'))
}

const openExternal = async ($: EngineInterface, editor: string, path: string) => {
  const { root } = await read($, snapshot)
  const argv = [...editor.split(/\s+/), `${root}/${path}`]
  const ran = await $.process.run(argv, { cwd: root }).catch((err: Error) => ({
    exitCode: 1,
    stderr: err.message,
  }))
  await update($, notice, () =>
    ran.exitCode === 0 ? `Abierto con: ${editor}` : `No se pudo abrir (${editor}): ${ran.stderr.trim()}`,
  )
}

export const register: Register = (on, options) => {
  const editor = String(options.editor ?? 'open').trim() || 'open'
  const background = String(options.background ?? '#0a0a0a').trim()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'worktree',
      description: 'Abre el primer archivo cambiado del worktree en un panel',
    })
    void refresh($)

    return started
  })

  on('command.run', { command: 'worktree' }, async $ => {
    await refresh($)
    const { changes, envFiles, error } = await read($, snapshot)
    const first = changes[0]?.path ?? envFiles[0]
    if (first === undefined) return { text: error ?? 'No hay archivos cambiados en el worktree.' }
    await openFile($, first)

    return { text: `Abierto ${first}.` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDITING_TOOLS.has(e.tool)) void refresh($).catch(() => undefined)

    return ran
  })

  // Above the prompt: one chip per changed file, as image-preview lists a draft's images.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    const listed = [
      ...snap.changes,
      ...snap.envFiles
        .filter(name => !snap.changes.some(one => one.path === name))
        .map(name => ({ path: name, code: 'env' }) as Change),
    ]
    if (listed.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, shown)
    const below = await next(e)
    const room = Math.max(12, Math.floor(e.props.bodyColumns / 3))
    const label = (path: string) => (path.length <= room ? path : `…/${baseName(path)}`)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {listed.slice(0, MAX_CHIPS).map(change => (
            <Box key={`chip-box:${change.path}`}>
              <Button key={`chip:${change.path}`} plain onPress={() => openFile($, change.path)}>
                <Text
                  color="claude"
                  inverse={current?.path === change.path}
                  hover={{ inverse: true }}
                >
                  [{label(change.path)}]
                </Text>
                {change.added !== undefined && change.added > 0 && (
                  <Text color="success"> +{change.added}</Text>
                )}
                {change.removed !== undefined && change.removed > 0 && (
                  <Text color="error"> -{change.removed}</Text>
                )}
              </Button>
            </Box>
          ))}
          {listed.length > MAX_CHIPS && <Text dimColor>+{listed.length - MAX_CHIPS} más</Text>}
          <Text dimColor>click para ver o editar</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Code } = table
    // The mobile app draws no text field: editing there goes through "Abrir fuera".
    const Input = 'Input' in table ? table.Input : undefined
    const snap = await read($, snapshot)
    const current = await read($, shown)
    const file = await read($, opened)
    const message = await read($, notice)
    const isDock = e.props.placement === 'dock'

    // A darker body than the terminal's; docked, it fills the pane's height.
    const frame = (children: RenderChildren) => (
      <Box
        flexDirection="column"
        paddingX={1}
        backgroundColor={background === '' ? undefined : background}
        minHeight={isDock ? e.props.scroll.bodyRows : undefined}
      >
        {children}
      </Box>
    )

    if (!current || !file || file.path !== current.path) {
      return frame(
        <Text color="subtle">Elige un archivo cambiado en la fila de arriba del prompt.</Text>,
      )
    }

    const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
    const change = snap.changes.find(one => one.path === file.path)
    const tab = (kind: View['kind'], text: string) =>
      current.kind === kind ? (
        <Text key={`tab-on:${kind}`} color="claude" bold underline>
          {text}
        </Text>
      ) : (
        <Button key={`to-${kind}`} label={text} plain dimColor onPress={() => go($, { kind, path: file.path })} />
      )

    const header = (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="truncate-end">
          <Text color="claude">⎇ {snap.branch || 'worktree'}</Text>
          <Text color="subtle"> · {tilde(snap.root)}</Text>
        </Text>
        <Text wrap="truncate-middle">
          <Text bold>{file.path}</Text>
          {change && <Text color={tone(change.code)}> {describe(change.code)}</Text>}
          {change?.added !== undefined && change.added > 0 && <Text color="success"> +{change.added}</Text>}
          {change?.removed !== undefined && change.removed > 0 && <Text color="error"> -{change.removed}</Text>}
        </Text>
        <Box gap={2}>
          {tab('diff', 'Diff')}
          {tab('edit', 'Editar')}
          {isEnvFile(baseName(file.path)) && tab('env', 'Variables')}
          <Button key="external" label="Abrir fuera ↗" plain dimColor onPress={() => openExternal($, editor, file.path)} />
          <Button key="close" label="✕" plain dimColor role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {message !== '' && (
          <Text color={message.startsWith('No se pudo') ? 'error' : 'success'}>{message}</Text>
        )}
      </Box>
    )

    if (current.kind === 'diff') {
      return frame(
        <>
          {header}
          {file.diff === '' ? (
            <Text color="subtle">Sin diff que mostrar (archivo binario, muy grande o sin cambios).</Text>
          ) : (
            <Code format="diff" source={file.diff} path={file.path} />
          )}
        </>,
      )
    }

    if (current.kind === 'edit') {
      const lines = file.text.split('\n')
      // A final newline is no line of its own to edit.
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
      if (Input === undefined || lines.length > MAX_EDIT_LINES) {
        return frame(
          <>
            {header}
            <Text color="subtle">
              {Input === undefined
                ? 'Esta superficie no tiene campos de texto; usa "Abrir fuera".'
                : `Archivo de ${lines.length} líneas: aquí se muestra sin editar; usa "Abrir fuera".`}
            </Text>
            <Code source={file.text} path={file.path} startLine={1} />
          </>,
        )
      }
      const editing = await read($, line)
      const width = String(lines.length).length
      const number = (index: number) => `${String(index + 1).padStart(width)} `
      return frame(
        <>
          {header}
          <Text color="subtle">Clic en una línea para editarla · Enter guarda</Text>
          {lines.map((text, index) =>
            editing === index ? (
              <Box key={`editing:${index}`} flexDirection="column" marginY={1}>
                <Input
                  key={`line:${index}`}
                  label={number(index)}
                  value={text}
                  autoFocus
                  submitLabel="guardar"
                  onSubmit={(value: string) => editLines($, file.path, all => all.splice(index, 1, ...value.split('\n')))}
                />
                <Box gap={2}>
                  <Button key="cancel-line" label="Cancelar" plain dimColor onPress={() => update($, line, () => null)} />
                  <Button key="delete-line" label="Borrar línea" plain dimColor onPress={() => editLines($, file.path, all => all.splice(index, 1))} />
                </Box>
              </Box>
            ) : (
              <Box key={`row:${index}`} hover={{ backgroundColor: 'promptBorder' }}>
                <Button key={`edit-line:${index}`} plain onPress={() => update($, line, () => index)}>
                  <Text color="subtle">{number(index)}</Text>
                  <Text>{text === '' ? ' ' : text}</Text>
                </Button>
              </Box>
            ),
          )}
          <Box marginTop={1}>
            <Input
              key="append-line"
              label="+ "
              placeholder="Agregar una línea al final"
              submitLabel="agregar"
              onSubmit={(value: string) =>
                editLines($, file.path, all => {
                  const end = all.length > 1 && all[all.length - 1] === '' ? all.length - 1 : all.length
                  all.splice(end, 0, ...value.split('\n'))
                })
              }
            />
          </Box>
        </>,
      )
    }

    const isRevealed = await read($, reveal)
    const vars = file.text
      .split('\n')
      .map(row => ENV_LINE.exec(row))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => ({ key: match[2] ?? '', value: match[4] ?? '' }))

    return frame(
      <>
        {header}
        <Button
          key="reveal"
          label={isRevealed ? 'Ocultar valores' : 'Mostrar valores'}
          plain
          onPress={() => update($, reveal, isOn => !isOn)}
        />
        {vars.length === 0 && <Text color="subtle">No hay variables todavía.</Text>}
        {vars.map(one =>
          isRevealed && Input !== undefined ? (
            <Box key={`row:${one.key}`}>
              <Input
                key={`var:${one.key}`}
                label={`${one.key}=`}
                value={one.value}
                submitLabel="guardar"
                onSubmit={(value: string) => setEnv($, file.path, one.key, value)}
              />
              <Button key={`del:${one.key}`} label="✕" plain onPress={() => removeEnv($, file.path, one.key)} />
            </Box>
          ) : (
            <Text key={`masked:${one.key}`}>
              <Text color="suggestion">{one.key}</Text>
              <Text color="subtle">={one.value === '' ? '(vacío)' : '••••••'}</Text>
            </Text>
          ),
        )}
        {Input !== undefined && (
          <Box marginTop={1}>
            <Input
              key="new-var"
              label="Nueva: "
              placeholder="CLAVE=valor"
              submitLabel="agregar"
              onSubmit={(value: string) => {
                const at = value.indexOf('=')
                const key = (at > 0 ? value.slice(0, at) : value).trim()
                if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
                  return update($, notice, () => 'Formato: CLAVE=valor')
                }
                return setEnv($, file.path, key, at > 0 ? value.slice(at + 1) : '')
              }}
            />
          </Box>
        )}
      </>,
    )
  })
}
