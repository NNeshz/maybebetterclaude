// added/removed are absent when unknown (a binary file, a value stored before counts).
export type Change = { path: string; code: string; added?: number; removed?: number; isBinary?: boolean }

export type View =
  | { kind: 'list' }
  | { kind: 'diff'; path: string }
  | { kind: 'edit'; path: string }
  | { kind: 'env'; path: string }

export type Snapshot = {
  root: string
  branch: string
  changes: Change[]
  envFiles: string[]
  repos: string[]
  error?: string
}

export type Opened = { path: string; text: string; diff: string }

declare module 'claude-code' {
  interface PluginState {
    'worktree-diff': {
      view: View
      snapshot: Snapshot
      opened: Opened | null
      reveal: boolean
      notice: string
      repo: string
    }
  }
}
