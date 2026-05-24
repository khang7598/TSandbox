import * as esbuild from 'esbuild'
import path from 'node:path'
import fs from 'node:fs/promises'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CompileResult {
  ok: true
  source: string
  compiledSource: string
}

export interface CompileError {
  ok: false
  errors: string[]
}

export type CompileOutcome = CompileResult | CompileError

// ─── Compiler ─────────────────────────────────────────────────────────────────
// Strategy:
//   - esbuild compiles TypeScript → CJS with `@mocktool/sdk` marked as external
//   - The compiled output contains: require('@mocktool/sdk')
//   - In the sandbox execution script, `require('@mocktool/sdk')` is intercepted
//     and returns inline SDK shim functions (see sandbox.ts)
//
// This is simpler and more reliable than esbuild plugins that access globalThis.

export async function compileFile(filePath: string): Promise<CompileOutcome> {
  let source: string
  try {
    source = await fs.readFile(filePath, 'utf8')
  } catch {
    return { ok: false, errors: [`Cannot read file: ${filePath}`] }
  }

  return compileSource(source, filePath)
}

export async function compileSource(
  source: string,
  filePath = '<mock>',
): Promise<CompileOutcome> {
  try {
    const ext = path.extname(filePath) || '.ts'
    const isJsx = ext === '.tsx' || ext === '.jsx'

    const result = await esbuild.build({
      stdin: {
        contents: source,
        resolveDir: path.dirname(path.resolve(filePath)),
        sourcefile: path.basename(filePath),
        loader: isJsx ? 'tsx' : 'ts',
      },
      bundle: true,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2022',
      write: false,
      // Mark @mocktool/sdk as external — the sandbox require() interceptor
      // handles it at runtime (see sandbox.ts buildExecutionScript)
      external: ['@tsandbox/sdk'],
      // Don't minify so error messages remain readable
      minifyWhitespace: false,
      minifyIdentifiers: false,
      minifySyntax: false,
    })

    if (result.errors.length > 0) {
      return {
        ok: false,
        errors: result.errors.map(
          (e) =>
            `${e.text}${
              e.location
                ? ` (${e.location.file}:${e.location.line}:${e.location.column})`
                : ''
            }`,
        ),
      }
    }

    const compiled = result.outputFiles[0]?.text ?? ''

    return { ok: true, source, compiledSource: compiled }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [msg] }
  }
}
