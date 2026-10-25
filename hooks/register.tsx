import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change, Opened, Snapshot, View } from '../types'

const PANE = 'worktree-diff'
const PLUGIN = 'worktree-diff'
const EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
const MAX_DIFF = 90000

const view = atom({ plugin: 'worktree-diff', key: 'view' } as const, { kind: 'list' } as View)
const snapshot = atom({ plugin: 'worktree-diff', key: 'snapshot' } as const, {
  root: '',
  branch: '',
  changes: [],
  envFiles: [],
  repos: [],
} as Snapshot)
const opened = atom({ plugin: 'worktree-diff', key: 'opened' } as const, null as Opened | null)
const reveal = atom({ plugin: 'worktree-diff', key: 'reveal' } as const, false)
const notice = atom({ plugin: 'worktree-diff', key: 'notice' } as const, '')
// A repository the person picked; empty follows the session's directory.
const repo = atom({ plugin: 'worktree-diff', key: 'repo' } as const, '')

const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/
const isEnvFile = (name: string) => /^\.env(\..+)?$/.test(name) || name === '.dev.vars'

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
  for (const line of raw.split('\n')) {
    const [added, removed, path] = line.split('\t')
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

const git = ($: EngineInterface, root: string, args: string[]) =>
  $.process.run(['git', ...args], { cwd: root, timeoutMs: 15000 })

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const picked = await read($, repo)
  const base = picked || cwd
  const top = await git($, base, ['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!top || top.exitCode !== 0) {
    const children = await $.fs.list(cwd).catch(() => [])
    const repos: string[] = []
    for (const child of children) {
      if (child.kind !== 'dir') continue
      if (await $.fs.exists(`${cwd}/${child.name}/.git`)) repos.push(child.name)
    }
    await update($, snapshot, () => ({
      root: cwd,
      branch: '',
      changes: [],
      envFiles: [],
      repos: repos.sort(),
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
    repos: [],
  }))
}

const loadFile = async ($: EngineInterface, path: string, withDiff: boolean) => {
  const { root, changes } = await read($, snapshot)
  const abs = `${root}/${path}`
  const text = await $.fs.read(abs).catch(() => '')
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

const go = async ($: EngineInterface, next: View) => {
  await update($, notice, () => '')
  if (next.kind !== 'list') await loadFile($, next.path, next.kind === 'diff')
  await update($, view, () => next)
}

const save = async ($: EngineInterface, path: string, text: string) => {
  const { root } = await read($, snapshot)
  await $.fs.write(`${root}/${path}`, text)
  await update($, opened, file => (file && file.path === path ? { ...file, text } : file))
  await update($, notice, () => `Guardado ${path}`)
  void refresh($)
}

const setEnv = async ($: EngineInterface, path: string, key: string, value: string) => {
  const file = await read($, opened)
  if (!file) return
  const lines = file.text.split('\n')
  const at = lines.findIndex(line => ENV_LINE.exec(line)?.[2] === key)
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
  const lines = file.text.split('\n').filter(line => ENV_LINE.exec(line)?.[2] !== key)
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

const pickRepo = async ($: EngineInterface, path: string) => {
  await update($, repo, () => path)
  await update($, view, () => ({ kind: 'list' }) as View)
  await refresh($)
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Worktree' })

export const register: Register = (on, options) => {
  const editor = String(options.editor ?? 'open').trim() || 'open'
  // The embedded editor's text as typed; read on save.
  let draft: string | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'worktree',
      description: 'Muestra los cambios del worktree en un panel',
    })
    void refresh($)
    void openPane($)

    return started
  })

  on('command.run', { command: 'worktree' }, async $ => {
    await refresh($)
    await openPane($)

    return { text: 'Panel del worktree abierto.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDITING_TOOLS.has(e.tool)) void refresh($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Code } = table
    // The mobile app draws no text field: editing there goes through "Abrir fuera".
    const Input = 'Input' in table ? table.Input : undefined
    const noInput = <Text color="subtle">Esta superficie no tiene campos de texto; usa "Abrir fuera".</Text>
    const rows = e.viewport?.rows ?? 30
    const snap = await read($, snapshot)
    const current = await read($, view)
    const file = await read($, opened)
    const message = await read($, notice)
    const pickedRepo = await read($, repo)
    // A snapshot stored before `repos` existed outlives a reload.
    const repos = snap.repos ?? []

    // Claude Code's own look: theme colors (they follow /theme), ⏺ headings,
    // ⎿ for what hangs under them, ~ for the home folder.
    const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
    const heading = (title: string, detail?: string) => (
      <Text>
        <Text color="claude">⏺ </Text>
        <Text bold>{title}</Text>
        {detail !== undefined && <Text color="subtle"> {detail}</Text>}
      </Text>
    )
    const hang = (index: number) => <Text color="subtle">{index === 0 ? '  ⎿  ' : '     '}</Text>

    const header = (
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color="claude" bold>⎇ {snap.branch || 'worktree'}</Text>
          <Text color="subtle"> · {tilde(snap.root)}</Text>
        </Text>
        {message !== '' && (
          <Text color={message.startsWith('No se pudo') ? 'error' : 'success'}>{message}</Text>
        )}
      </Box>
    )

    const back = (
      <Button key="back" label="← Volver" plain onPress={() => go($, { kind: 'list' })} />
    )

    if (current.kind === 'list' || !file || file.path !== current.path) {
      const shown = snap.changes.slice(0, Math.max(3, rows - 12))
      const added = snap.changes.reduce((sum, one) => sum + (one.added ?? 0), 0)
      const removed = snap.changes.reduce((sum, one) => sum + (one.removed ?? 0), 0)
      const totals = added + removed > 0 ? ` +${added} -${removed}` : ''
      return (
        <Box flexDirection="column">
          {header}
          {snap.error !== undefined && <Text color="error">{snap.error}</Text>}
          {repos.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {heading('Elige un repositorio')}
              {repos.map((name, index) => (
                <Box key={`repo-row:${name}`} hover={{ backgroundColor: 'promptBorder' }}>
                  {hang(index)}
                  <Button key={`repo:${name}`} plain onPress={() => pickRepo($, `${snap.root}/${name}`)}>
                    {name}
                  </Button>
                </Box>
              ))}
            </Box>
          )}
          {snap.error === undefined && (
            <Box flexDirection="column">
              {heading('Cambios', `(${snap.changes.length})${totals}`)}
              {snap.changes.length === 0 && (
                <Text>
                  {hang(0)}
                  <Text color="subtle">Sin cambios</Text>
                </Text>
              )}
              {shown.map((change, index) => (
                <Box key={`file-row:${change.path}`} hover={{ backgroundColor: 'promptBorder' }}>
                  {hang(index)}
                  <Button
                    key={`file:${change.path}`}
                    plain
                    onPress={() => go($, { kind: 'diff', path: change.path })}
                  >
                    <Text
                      color={
                        change.code === '??' || change.code.includes('A')
                          ? 'success'
                          : change.code.includes('D')
                            ? 'error'
                            : 'warning'
                      }
                    >
                      {change.code.replace(/ /g, '·')}
                    </Text>{' '}
                    <Text hover={{ underline: true }}>{change.path}</Text>
                    {change.isBinary === true && <Text color="subtle"> binario</Text>}
                    {change.added !== undefined && change.added > 0 && (
                      <Text color="success"> +{change.added}</Text>
                    )}
                    {change.removed !== undefined && change.removed > 0 && (
                      <Text color="error"> -{change.removed}</Text>
                    )}
                  </Button>
                </Box>
              ))}
            </Box>
          )}
          {snap.envFiles.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {heading('Variables de entorno')}
              {snap.envFiles.map((name, index) => (
                <Box key={`env-row:${name}`} hover={{ backgroundColor: 'promptBorder' }}>
                  {hang(index)}
                  <Button key={`env:${name}`} plain onPress={() => go($, { kind: 'env', path: name })}>
                    {name}
                  </Button>
                </Box>
              ))}
            </Box>
          )}
          <Box gap={2} marginTop={1}>
            <Button key="refresh" label="↻ Refrescar" plain onPress={() => refresh($)} />
            {pickedRepo !== '' && (
              <Button key="change-repo" label="Cambiar repo" plain onPress={() => pickRepo($, '')} />
            )}
          </Box>
        </Box>
      )
    }

    const actions = (
      <Box gap={2} marginBottom={1}>
        {back}
        {current.kind !== 'diff' && (
          <Button key="to-diff" label="Diff" plain onPress={() => go($, { kind: 'diff', path: file.path })} />
        )}
        {current.kind !== 'edit' && (
          <Button key="to-edit" label="Editar aquí" plain onPress={() => go($, { kind: 'edit', path: file.path })} />
        )}
        {current.kind !== 'env' && isEnvFile(file.path.split('/').pop() ?? '') && (
          <Button key="to-env" label="Variables" plain onPress={() => go($, { kind: 'env', path: file.path })} />
        )}
        <Button key="external" label="Abrir fuera ↗" plain onPress={() => openExternal($, editor, file.path)} />
      </Box>
    )

    if (current.kind === 'diff') {
      return (
        <Box flexDirection="column">
          {header}
          {heading(file.path)}
          {actions}
          {file.diff === '' ? (
            <Text color="subtle">Sin diff que mostrar (archivo binario, muy grande o sin cambios).</Text>
          ) : (
            <Box borderStyle="round" borderColor="subtle" paddingX={1}>
              <Code format="diff" source={file.diff} path={file.path} />
            </Box>
          )}
        </Box>
      )
    }

    if (current.kind === 'edit') {
      draft = file.text
      return (
        <Box flexDirection="column">
          {header}
          {heading(file.path)}
          {actions}
          {Input === undefined ? noInput : <Box borderStyle="round" borderColor="promptBorder" paddingX={1}><Input
            key={`editor:${file.path}`}
            rows={Math.max(4, Math.min(30, rows - 10))}
            value={file.text}
            submitLabel="guardar"
            onInput={(value: string) => {
              draft = value
            }}
            onSubmit={(value: string) => save($, file.path, value)}
          /></Box>}
          <Button
            key="save"
            variant="primary"
            label="Guardar"
            onPress={() => save($, file.path, draft ?? file.text)}
          />
        </Box>
      )
    }

    const isRevealed = await read($, reveal)
    const vars = file.text
      .split('\n')
      .map(line => ENV_LINE.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => ({ key: match[2] ?? '', value: match[4] ?? '' }))

    return (
      <Box flexDirection="column">
        {header}
        {heading(file.path)}
        {actions}
        <Button
          key="reveal"
          label={isRevealed ? 'Ocultar valores' : 'Mostrar valores'}
          plain
          onPress={() => update($, reveal, shown => !shown)}
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
        {Input !== undefined && <Box marginTop={1} borderStyle="round" borderColor="promptBorder" paddingX={1}>
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
        </Box>}
      </Box>
    )
  })
}
