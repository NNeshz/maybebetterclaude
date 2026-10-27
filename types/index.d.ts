// added/removed are absent when unknown (a binary file, a value stored before counts).
export type Change = { path: string; code: string; added?: number; removed?: number; isBinary?: boolean }

// One file in the pane: its source colored, the editor, rendered markdown, its
// diff, or its variables. `worktree` names another worktree's root: the file is
// read there and shown read-only.
export type FileView = { kind: 'code' | 'edit' | 'preview' | 'diff' | 'env'; path: string; worktree?: string }

// What the pane shows: one file, or the list of every changed file.
export type View = FileView | { kind: 'files' }

export type Snapshot = {
  root: string
  branch: string
  changes: Change[]
  envFiles: string[]
  error?: string
}

// Another worktree of the repository: its root, its branch, the first of its
// changed files and the counts over all of them.
export type Worktree = { root: string; branch: string; changes: Change[]; total: number; added: number; removed: number }

// The "Otros worktrees" section of the list: asked only while the list is open.
export type Others = { worktrees: Worktree[]; total: number }

export type Opened = { path: string; text: string; diff: string; worktree?: string }

// A write to an environment file, held until the person says yes in the pane.
export type Confirm = { path: string; text: string }

// What the editor's surface module is handed: the file as it is on disk (a new
// `version` each time it is read), the gutter marks by 1-based line, and the
// wheel's travel so far, which the module turns into scrolling.
export type EditorProps = {
  path: string
  text: string
  version: number
  marks: [number, 'added' | 'modified' | 'deleted'][]
  wheel: number
  autosave: boolean
}

// What the editor posts: the buffer as typed, or a save asked with ctrl+s.
export type EditorMessage = { type: 'change' | 'save'; path: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'worktree-diff': {
      shown: View | null
      snapshot: Snapshot
      others: Others
      expanded: string | null
      opened: Opened | null
      confirm: Confirm | null
      reveal: boolean
      notice: string
      top: number
      wheel: number
      version: number
      dirty: boolean
      autosave: boolean
    }
  }
}
