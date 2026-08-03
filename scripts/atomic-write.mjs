import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function atomicWriteFile(filePath, content, options = {}) {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  let handle
  try {
    handle = await open(temporaryPath, 'wx', options.mode ?? 0o600)
    await handle.writeFile(content, options.encoding ?? 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
    await syncDirectory(directory)
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true })
  }
}

export async function writeFileIfChanged(filePath, content, options = {}) {
  try {
    if (await readFile(filePath, options.encoding ?? 'utf8') === content) return false
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  await atomicWriteFile(filePath, content, options)
  return true
}

async function syncDirectory(directory) {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (process.platform !== 'win32') throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
