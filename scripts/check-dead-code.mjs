import ts from 'typescript'

const UNUSED_DIAGNOSTIC_CODES = new Set([6133, 6192, 6196, 6198])
const failures = []

const configResult = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
if (configResult.error) {
  failures.push(ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n'))
} else {
  const config = ts.parseJsonConfigFileContent(configResult.config, ts.sys, process.cwd())
  const serverFiles = ts.sys.readDirectory('server', ['.ts'], undefined, ['**/*.ts'])
  const program = ts.createProgram({
    rootNames: [...new Set([...config.fileNames, ...serverFiles])],
    options: {
      ...config.options,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
  })

  for (const diagnostic of program.getSemanticDiagnostics()) {
    if (!diagnostic.file || !UNUSED_DIAGNOSTIC_CODES.has(diagnostic.code)) continue
    const filename = diagnostic.file.fileName.replaceAll('\\', '/')
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    failures.push(
      `${filename}:${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    )
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`dead code error: ${failure}`)
  process.exit(1)
}

console.log('dead code symbol checks ok')
