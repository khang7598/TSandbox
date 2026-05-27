import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { X, Save, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { useFileContent, useSaveFile, useCompileErrors } from '@/api/mocks'
import { useAppStore } from '@/store'
import { configureMonaco } from '@/lib/monaco-sdk'
import client from '@/api/client'
import type { FileNode } from '@/types'

interface EditorTabsProps {
  openFiles: string[]
  activeFile: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

function EditorTabs({ openFiles, activeFile, onSelect, onClose }: EditorTabsProps) {
  function getFileName(path: string) {
    return path.split('/').pop() ?? path
  }

  return (
    <div className="flex items-center overflow-x-auto bg-slate-900 border-b border-slate-700 flex-shrink-0">
      {openFiles.map((file) => (
        <div
          key={file}
          onClick={() => onSelect(file)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-slate-700 min-w-0 flex-shrink-0 max-w-40',
            activeFile === file
              ? 'bg-slate-800 text-slate-100 border-t-2 border-t-blue-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
          )}
        >
          <span className="truncate">{getFileName(file)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose(file)
            }}
            className="flex-shrink-0 text-slate-500 hover:text-slate-200 rounded p-0.5 hover:bg-slate-600"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  )
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface MonacoEditorPanelProps {
  sandboxId: string | null
}

export default function MonacoEditorPanel({ sandboxId }: MonacoEditorPanelProps) {
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFile = useAppStore((s) => s.activeFile)
  const closeFile = useAppStore((s) => s.closeFile)
  const setActiveFile = useAppStore((s) => s.setActiveFile)

  const [localContent, setLocalContent] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [monacoReady, setMonacoReady] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const pendingNavigation = useAppStore((s) => s.pendingNavigation)
  const setPendingNavigation = useAppStore((s) => s.setPendingNavigation)

  const { data: fileContent } = useFileContent(sandboxId, activeFile)
  const { data: compileErrors } = useCompileErrors(sandboxId)
  const saveFile = useSaveFile()

  // Reset so background model load re-runs for the new sandbox
  useEffect(() => {
    setMonacoReady(false)
  }, [sandboxId])

  // When file content loads, update local content
  useEffect(() => {
    if (fileContent !== undefined) {
      setLocalContent(fileContent)
    }
  }, [fileContent, activeFile])

  // Set Monaco error markers when compile errors change
  useEffect(() => {
    if (!monacoRef.current || !editorRef.current || !compileErrors) return
    const monaco = monacoRef.current
    const activeErrors = compileErrors.filter((e) => e.file_path === activeFile)
    const markers: editor.IMarkerData[] = activeErrors.flatMap((e) =>
      e.errors.map((msg) => ({
        severity: monaco.MarkerSeverity.Error,
        message: msg,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 100,
      })),
    )
    const model = editorRef.current.getModel()
    if (model) {
      monaco.editor.setModelMarkers(model, 'compile-errors', markers)
    }
  }, [compileErrors, activeFile])

  // Navigate to a specific line when a search result is clicked
  useEffect(() => {
    if (!pendingNavigation || pendingNavigation.file !== activeFile || !editorRef.current || !localContent) return
    const { line } = pendingNavigation
    editorRef.current.revealLineInCenter(line)
    editorRef.current.setPosition({ lineNumber: line, column: 1 })
    editorRef.current.focus()
    setPendingNavigation(null)
  }, [pendingNavigation, activeFile, localContent, setPendingNavigation])

  // Load all sandbox TS/JS files as background Monaco models so relative
  // imports resolve (e.g. `import { users } from './data'`).
  useEffect(() => {
    if (!sandboxId || !monacoReady || !monacoRef.current) return
    const monaco = monacoRef.current
    let cancelled = false

    async function loadBackgroundModels() {
      try {
        const treeRes = await client.get<FileNode[]>(`/sandboxes/${sandboxId}/files`)
        if (cancelled) return
        const filePaths = flattenTree(treeRes.data)

        for (const filePath of filePaths) {
          if (cancelled) return
          try {
            const contentRes = await client.get<{ path: string; content: string }>(
              `/sandboxes/${sandboxId}/files/${filePath}`,
            )
            if (cancelled) return
            const content = contentRes.data.content
            const lang = /\.tsx?$/.test(filePath) ? 'typescript' : 'javascript'
            const uri = monaco.Uri.parse(`file:///${filePath}`)
            const existing = monaco.editor.getModel(uri)
            if (existing) {
              // Update stale content (e.g. after sandbox switch)
              if (existing.getValue() !== content) existing.setValue(content)
            } else {
              monaco.editor.createModel(content, lang, uri)
            }
          } catch {
            // ignore individual file errors
          }
        }
      } catch {
        // ignore
      }
    }

    loadBackgroundModels()
    return () => {
      cancelled = true
    }
  }, [sandboxId, monacoReady])

  const doSave = useCallback(
    async (content: string) => {
      if (!sandboxId || !activeFile) return
      setSaveStatus('saving')
      try {
        await saveFile.mutateAsync({ sandboxId, filePath: activeFile, content })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
        // Keep background model in sync so other files' imports see latest content
        if (monacoRef.current) {
          const uri = monacoRef.current.Uri.parse(`file:///${activeFile}`)
          const model = monacoRef.current.editor.getModel(uri)
          if (model && model.getValue() !== content) {
            model.setValue(content)
          }
        }
      } catch {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
      }
    },
    [sandboxId, activeFile, saveFile],
  )

  function handleChange(value: string | undefined) {
    const content = value ?? ''
    setLocalContent(content)

    // Debounce auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      doSave(content)
    }, 1500)
  }

  function handleEditorDidMount(editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editorInstance
    monacoRef.current = monaco
    setMonacoReady(true)

    // Ctrl+S / Cmd+S to save
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        doSave(editorInstance.getValue())
      },
    )
  }

  const language = activeFile?.endsWith('.tsx') || activeFile?.endsWith('.ts') ? 'typescript' : 'javascript'

  if (!activeSandboxOrFile(sandboxId, activeFile, openFiles)) {
    return (
      <div className="flex-1 flex flex-col bg-slate-900">
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <AlertCircle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No file open</p>
            <p className="text-xs mt-1">Select a file from the sidebar to edit it</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-900 min-h-0">
      <EditorTabs
        openFiles={openFiles}
        activeFile={activeFile}
        onSelect={setActiveFile}
        onClose={closeFile}
      />
      <div className="flex-1 min-h-0 relative">
        <Editor
          key={activeFile}
          language={language}
          value={localContent}
          path={activeFile ? `file:///${activeFile}` : undefined}
          onChange={handleChange}
          beforeMount={configureMonaco}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbersMinChars: 3,
            folding: true,
            renderLineHighlight: 'line',
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            automaticLayout: true,
          }}
        />
        {/* Save status indicator */}
        <div
          className={clsx(
            'absolute bottom-3 right-4 flex items-center gap-1 text-xs px-2 py-1 rounded transition-opacity duration-300',
            saveStatus === 'idle' && 'opacity-0',
            saveStatus === 'saving' && 'opacity-100 bg-slate-700 text-slate-300',
            saveStatus === 'saved' && 'opacity-100 bg-green-900/50 text-green-400',
            saveStatus === 'error' && 'opacity-100 bg-red-900/50 text-red-400',
          )}
        >
          <Save size={11} />
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </div>
      </div>
    </div>
  )
}

function activeSandboxOrFile(
  sandboxId: string | null,
  activeFile: string | null,
  openFiles: string[],
) {
  return sandboxId && activeFile && openFiles.includes(activeFile)
}

function flattenTree(nodes: FileNode[]): string[] {
  const result: string[] = []
  for (const node of nodes) {
    if (node.type === 'file' && /\.(tsx?|jsx?)$/.test(node.path)) {
      result.push(node.path)
    }
    if (node.children) {
      result.push(...flattenTree(node.children))
    }
  }
  return result
}
