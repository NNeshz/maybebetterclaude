import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'worktree-diff',
  component: 'Pane',
  requestId: 'worktree-diff',
  props: {
    title: 'Worktree',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'worktree-diff',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const DIFF = '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-const a = 0\n+const a = 1\n const b = 2\n'
const DIFF_Y = '--- a/lib/x.ts\n+++ b/lib/x.ts\n@@ -1,1 +1,1 @@\n-const y = 0\n+const y = 1\n'
// git worktree list --porcelain: the session's own, one on a branch, one prunable
// (left out), one detached.
const WORKTREES =
  'worktree /repo\nHEAD 1111\nbranch refs/heads/feature-x\n\n' +
  'worktree /repo-wt/feat-y\nHEAD 2222\nbranch refs/heads/feat-y\n\n' +
  'worktree /repo-wt/old\nHEAD 3333\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n\n' +
  'worktree /repo-wt/loose\nHEAD 4444\ndetached\n\n'

type World = { files: Record<string, string>; written: Record<string, string>; opens: string[]; asked: string[] }

// The engine beneath the plugin: a repository at /repo on feature-x with one
// modified file, one new file and a .env; beside it the other worktrees, each
// answered by the cwd git is run in.
const seed = (on: On, files: Record<string, string>): World => {
  const world: World = { files, written: {}, opens: [], asked: [] }

  // The engine's own band, beneath the plugin's chips.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', () => ({ value: { command: 'worktree' } }))
  on('ui.open', (_, e) => {
    world.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    const cwd = e.init?.cwd ?? '/repo'
    world.asked.push(`${cwd}: ${args}`)
    const stdout = args.includes('worktree list')
      ? WORKTREES
      : args.includes('rev-parse')
        ? '/repo\n'
        : args.includes('branch')
          ? 'feature-x\n'
          : cwd === '/repo-wt/feat-y'
            ? args.includes('numstat')
              ? '3\t1\tlib/x.ts\n'
              : args.includes('status')
                ? ' M lib/x.ts\0'
                : args.includes('diff')
                  ? DIFF_Y
                  : ''
            : cwd === '/repo-wt/loose'
              ? args.includes('status')
                ? '?? todo.md\0'
                : ''
              : args.includes('numstat')
                ? '1\t1\tsrc/app.ts\n'
                : args.includes('status')
                  ? ' M src/app.ts\0?? notes.md\0'
                  : args.includes('diff')
                    ? DIFF
                    : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', () => ({
    value: [
      { name: '.env', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
      { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_, e) => ({ value: world.files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    world.written[e.path] = e.text
    world.files[e.path] = e.text
    return { value: undefined }
  })

  return world
}

const FILES = () => ({
  '/repo/src/app.ts': 'const a = 1\nconst b = 2\n',
  '/repo/notes.md': 'uno\ndos\n',
  '/repo/.env': 'API_URL=http://localhost\nSECRET=abc\n',
  '/repo-wt/feat-y/lib/x.ts': 'const y = 1\n',
  '/repo-wt/loose/todo.md': 'pendiente\n',
})

test('lists changed files above the prompt and opens one only when picked', async ($, on) => {
  const { written, opens } = seed(on, FILES())

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Nothing opens by itself.
  expect(opens).toEqual([])

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'chip:src/app.ts' })).toBeDefined()
  expect(await band.find({ key: 'chip:notes.md' })).toBeDefined()
  expect(await band.find({ key: 'chip:.env' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^ \+2$/ })).toBeDefined()
  await band.press({ key: 'chip:src/app.ts' })
  expect(opens).toEqual(['worktree-diff'])
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /feature-x/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /·\s+modificado$/ })).toBeDefined()
  expect(await ui.find({ key: 'to-diff' })).toBeDefined()

  // It opens on its colored source; Editar is the editor, a surface module:
  // the keys it takes change its buffer, ctrl+s posts a save.
  expect(await ui.find({ key: 'edit-line:0' })).toBeDefined()
  await ui.press({ key: 'to-edit' })
  await ui.resize({ columns: 60, rows: 20, in: 'editor' })
  await ui.key({ key: 'down', in: 'editor' })
  await ui.key({ key: 'end', in: 'editor' })
  await ui.key({ key: 'backspace', in: 'editor' })
  await ui.key({ key: '3', in: 'editor' })
  await ui.key({ key: 's', ctrl: true, in: 'editor' })
  expect(written['/repo/src/app.ts']).toBe('const a = 1\nconst b = 3\n')
  await ui.unmount()

  // The summary opens every changed file as a list.
  const band3 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band3.press({ key: 'all-files' })
  await band3.unmount()
  const list = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await list.find({ key: 'file:src/app.ts' })).toBeDefined()
  await list.press({ key: 'file:notes.md' })
  await list.unmount()

  // A markdown file offers its preview beside its source.
  const md = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await md.find({ key: 'edit-line:0' })).toBeDefined()
  await md.press({ key: 'to-preview' })
  expect(await md.find({ key: 'edit-line:0' })).toBeUndefined()
  await md.unmount()

  // A .env with no change opens on its variables. With editEnv off (the
  // default) they are looked at, masked until revealed, and never changed.
  const band2 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band2.press({ key: 'chip:.env' })
  await band2.unmount()
  const env = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await env.find({ type: 'Text', text: /SECRET=••••••/ })).toBeDefined()
  expect(await env.find({ type: 'Text', text: /\/config/ })).toBeDefined()
  expect(await env.find({ key: 'to-edit' })).toBeUndefined()
  await env.press({ key: 'reveal' })
  expect(await env.find({ type: 'Text', text: /SECRET=abc/ })).toBeDefined()
  expect(await env.find({ key: 'var:SECRET' })).toBeUndefined()
  expect(await env.find({ key: 'del:SECRET' })).toBeUndefined()
  expect(await env.find({ key: 'new-var' })).toBeUndefined()
  expect(written['/repo/.env']).toBeUndefined()
  await env.unmount()
})

test('lists the other worktrees under the files and opens theirs read-only', async ($, on) => {
  const { asked, opens } = seed(on, FILES())
  const clock = mock.clock(on)
  const askedWorktrees = () => asked.filter(line => line.includes('worktree list')).length

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // The other worktrees are asked only once the list is open: the band shows
  // this worktree alone.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(askedWorktrees()).toBe(0)
  expect(await band.find({ key: 'chip:lib/x.ts' })).toBeUndefined()
  await band.press({ key: 'all-files' })
  expect(askedWorktrees()).toBe(1)
  await band.unmount()

  // One row a worktree: its branch, its folder, its counts; the prunable one
  // and this one are left out. Its files show once it is picked.
  const list = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await list.find({ key: 'file:src/app.ts' })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /Otros worktrees/ })).toBeDefined()
  expect(await list.find({ key: 'worktree:/repo-wt/feat-y' })).toBeDefined()
  expect(await list.find({ key: 'worktree:/repo-wt/loose' })).toBeDefined()
  expect(await list.find({ key: 'worktree:/repo-wt/old' })).toBeUndefined()
  expect(await list.find({ key: 'worktree:/repo' })).toBeUndefined()
  expect(await list.find({ type: 'Text', text: /feat-y/ })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /\(detached\)/ })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /\/repo-wt\/feat-y/ })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /^ \+3$/ })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /^1 archivo$/ })).toBeDefined()
  expect(await list.find({ key: 'other-file:/repo-wt/feat-y:lib/x.ts' })).toBeUndefined()
  await list.press({ key: 'worktree:/repo-wt/feat-y' })
  expect(await list.find({ key: 'other-file:/repo-wt/feat-y:lib/x.ts' })).toBeDefined()
  expect(await list.find({ key: 'other-file:/repo-wt/loose:todo.md' })).toBeUndefined()
  // Each refresh after a tool asks them again while the list is open.
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.settle()
  expect(askedWorktrees()).toBe(2)
  await list.press({ key: 'other-file:/repo-wt/feat-y:lib/x.ts' })
  expect(opens).toEqual(['worktree-diff', 'worktree-diff'])
  await list.unmount()

  // The file of another worktree: its branch leads the breadcrumb, its source
  // and diff are shown, nothing edits it.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⎇ feat-y › / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /solo lectura/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /const y = 1/ })).toBeDefined()
  expect(await ui.find({ key: 'to-diff' })).toBeDefined()
  expect(await ui.find({ key: 'to-edit' })).toBeUndefined()
  expect(await ui.find({ key: 'edit-line:0' })).toBeUndefined()
  await ui.press({ key: 'to-diff' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  // "‹" goes back to the list, the worktree still open.
  await ui.press({ key: 'to-files' })
  expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
  expect(await ui.find({ key: 'other-file:/repo-wt/feat-y:lib/x.ts' })).toBeDefined()
  await ui.unmount()
})

test('edits an environment file only with editEnv on, each save confirmed, never autosaved', { options: { editEnv: true } }, async ($, on) => {
  const { written } = seed(on, FILES())
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'chip:.env' })
  await band.unmount()

  // A variable's save waits for the answer: "n" drops it, "y" writes it.
  const env = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await env.find({ type: 'Text', text: /\/config/ })).toBeUndefined()
  expect(await env.find({ key: 'to-edit' })).toBeDefined()
  await env.press({ key: 'reveal' })
  await env.input({ key: 'var:SECRET', text: 'xyz' })
  expect(written['/repo/.env']).toBeUndefined()
  expect(await env.find({ key: 'confirm-env' })).toBeDefined()
  expect((await env.find({ key: 'confirm-env' }))?.props.label).toMatch(/Guardar cambios en \.env\? \(y\/n\)/)
  await env.input({ key: 'confirm-env', text: 'n' })
  expect(written['/repo/.env']).toBeUndefined()
  expect(await env.find({ key: 'confirm-env' })).toBeUndefined()
  await env.input({ key: 'var:SECRET', text: 'xyz' })
  await env.input({ key: 'confirm-env', text: 'y' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\n')
  // A new variable, and the buttons answer too.
  await env.input({ key: 'new-var', text: 'DEBUG=1' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\n')
  await env.press({ key: 'confirm-yes' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\nDEBUG=1\n')
  // Removing one asks as well.
  await env.press({ key: 'del:DEBUG' })
  await env.press({ key: 'confirm-no' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\nDEBUG=1\n')

  // The editor: no autosave for an environment file, whatever the toggle; a
  // pause writes nothing, ctrl+s asks, Guardar asks.
  await env.press({ key: 'to-edit' })
  expect(await env.find({ key: 'autosave' })).toBeUndefined()
  expect(await env.find({ key: 'save' })).toBeDefined()
  await env.resize({ columns: 60, rows: 20, in: 'editor' })
  await env.key({ key: 'end', in: 'editor' })
  await env.key({ key: '!', in: 'editor' })
  await clock.advance(5000)
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\nDEBUG=1\n')
  expect(await env.find({ key: 'confirm-env' })).toBeUndefined()
  await env.key({ key: 's', ctrl: true, in: 'editor' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\nDEBUG=1\n')
  expect(await env.find({ key: 'confirm-env' })).toBeDefined()
  await env.press({ key: 'confirm-yes' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost!\nSECRET=xyz\nDEBUG=1\n')
  await env.key({ key: '?', in: 'editor' })
  await env.press({ key: 'save' })
  expect(await env.find({ key: 'confirm-env' })).toBeDefined()
  await env.press({ key: 'confirm-no' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost!\nSECRET=xyz\nDEBUG=1\n')
  await env.unmount()
})
