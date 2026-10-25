import { expect, test } from 'claude-code/testing'

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

test('lists changes and edits a .env value', async ($, on) => {
  const written: Record<string, string> = {}
  let envText = 'API_URL=http://localhost\nSECRET=abc\n'

  on('command.register', () => ({ value: { command: 'worktree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('rev-parse')
      ? '/repo\n'
      : args.includes('branch')
        ? 'feature-x\n'
        : args.includes('numstat')
          ? '3\t1\tsrc/app.ts\n'
        : args.includes('status')
          ? ' M src/app.ts\0?? notes.md\0'
          : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('fs.list', () => ({
    value: [
      { name: '.env', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
      { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', () => ({ value: envText }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    envText = e.text
    return { value: undefined }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'worktree' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /feature-x/ }))).toBeDefined()
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file:notes.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ \+3$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ -1$/ })).toBeDefined()
    // notes.md is untracked: its lines are counted from the file (fs.read's two lines).
    expect(await ui.find({ type: 'Text', text: /^ \+2$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'env:.env' })
  expect(await ui.find({ type: 'Text', text: /SECRET=••••••/ })).toBeDefined()
  await ui.press({ key: 'reveal' })
  await ui.input({ key: 'var:SECRET', text: 'xyz' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\n')
  await ui.input({ key: 'new-var', text: 'DEBUG=1' })
  expect(written['/repo/.env']).toBe('API_URL=http://localhost\nSECRET=xyz\nDEBUG=1\n')
  await ui.unmount()
})
