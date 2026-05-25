import JSZip from 'jszip'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { db, queries, type SandboxRow } from '../db/index.js'
import { processFileChange } from '../runtime/hot-reload.js'
import { config } from '../config.js'

interface SandboxManifest {
  name: string
  description: string | null
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportSandbox(sandboxId: string): Promise<Buffer> {
  const row = queries.getSandbox.get(sandboxId) as SandboxRow
  const dir = path.join(config.sandboxesDir, sandboxId)

  const zip = new JSZip()

  const manifest: SandboxManifest = {
    name: row.name,
    description: row.description ?? null,
  }
  zip.file('sandbox.json', JSON.stringify(manifest, null, 2))

  await addDirToZip(zip, dir, dir)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>
}

async function addDirToZip(zip: JSZip, dir: string, rootDir: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, rootDir)
    } else {
      const content = await fs.readFile(fullPath)
      zip.file(relativePath, content)
    }
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export async function importSandbox(zipBuffer: Buffer): Promise<SandboxRow> {
  const zip = await JSZip.loadAsync(zipBuffer)

  const manifestFile = zip.file('sandbox.json')
  if (!manifestFile) throw new Error('Invalid archive: missing sandbox.json')

  const manifest = JSON.parse(await manifestFile.async('string')) as SandboxManifest
  if (!manifest.name?.trim()) throw new Error('Invalid sandbox.json: name is required')

  const id = crypto.randomUUID()
  const now = Date.now()
  queries.createSandbox.run(id, manifest.name.trim(), manifest.description ?? null, now, now)

  const sandboxDir = path.join(config.sandboxesDir, id)
  await fs.mkdir(sandboxDir, { recursive: true })

  const fileEntries = Object.entries(zip.files).filter(
    ([name, entry]) => name !== 'sandbox.json' && !entry.dir,
  )

  for (const [rawPath, zipEntry] of fileEntries) {
    // Sanitise path to prevent ZIP traversal attacks
    const safeParts = rawPath
      .split('/')
      .filter((p) => p !== '..' && p !== '.' && p.length > 0)
    if (safeParts.length === 0) continue

    const relativePath = safeParts.join('/')
    const filePath = path.join(sandboxDir, relativePath)

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = await zipEntry.async('nodebuffer')
    await fs.writeFile(filePath, content)

    if (/\.(ts|tsx|js)$/.test(relativePath)) {
      await processFileChange({ type: 'add', filePath, sandboxId: id })
    }
  }

  return queries.getSandbox.get(id) as SandboxRow
}
