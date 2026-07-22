import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import ts from 'typescript'

const failures = []

await checkGlob('server/optimization/**/*.ts', 800)
await checkGlob('src/pages/admin/**/*.ts', 800)
await checkGlob('src/pages/admin/**/*.tsx', 900)
await checkGlob('src/pages/tool/optimize/**/*.ts', 800)
await checkGlob('src/pages/tool/optimize/**/*.tsx', 800)
await checkFile('src/pages/AdminPage.tsx', 400)
await checkFile('src/pages/OptimizePage.tsx', 400)
await checkFile('server/handlers/optimization.ts', 300)
await checkGlob('server/optimization/engine/**/*.ts', 300)
const typeProgram = createArchitectureTypeProgram()
checkNewPageModuleUnusedSymbols(typeProgram)
checkOptimizationUnusedImports(typeProgram)
await checkProductCatalogOwnership()

const engineFiles = []
for await (const filename of glob('server/optimization/**/*.ts')) engineFiles.push(filename)
for (const filename of engineFiles) {
  if (filename.replaceAll('\\', '/').includes('/jobs/')) continue
  const source = await readFile(filename, 'utf8')
  if (/from\s+['"]\.\.\/\.\.\/handlers\/(?!data)/.test(source)) {
    failures.push(`${filename}: optimization core imports a handler`)
  }
  if (/from\s+['"][^'"]*(storage|optimize-job-runner)/.test(source)) {
    failures.push(`${filename}: optimization core imports orchestration/storage`)
  }
}

for await (const filename of glob('server/handlers/**/*.ts')) {
  if (filename.endsWith('.test.ts')) continue
  const source = await readFile(filename, 'utf8')
  if (/from\s+['"][^'"]*\/optimization\/(?!jobs\/)/.test(source)) {
    failures.push(`${filename}: API handler imports optimization core directly`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`architecture error: ${failure}`)
  process.exit(1)
}
console.log(`architecture checks ok (${engineFiles.length} optimization modules)`)

async function checkGlob(pattern, limit) {
  for await (const filename of glob(pattern)) await checkFile(filename, limit)
}

async function checkFile(filename, limit) {
  const source = await readFile(filename, 'utf8')
  const lines = source.split(/\r?\n/).length
  if (lines <= limit) return
  const message = `${filename}: ${lines} lines exceeds ${limit}`
  failures.push(message)
}

function createArchitectureTypeProgram() {
  const configResult = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  if (configResult.error) {
    failures.push(ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n'))
    return null
  }
  const config = ts.parseJsonConfigFileContent(configResult.config, ts.sys, process.cwd())
  const serverFiles = ts.sys.readDirectory('server', ['.ts'], undefined, ['**/*.ts'])
  return ts.createProgram({
    rootNames: [...new Set([...config.fileNames, ...serverFiles])],
    options: {
      ...config.options,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
  })
}

function checkNewPageModuleUnusedSymbols(program) {
  if (!program) return
  const unusedCodes = new Set([6133, 6192, 6196])
  const pageModulePattern = /\/src\/pages\/(?:admin\/|tool\/optimize\/)/
  for (const diagnostic of program.getSemanticDiagnostics()) {
    if (!diagnostic.file || !unusedCodes.has(diagnostic.code)) continue
    const filename = diagnostic.file.fileName.replaceAll('\\', '/')
    if (!pageModulePattern.test(filename)) continue
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    failures.push(
      `${filename}:${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    )
  }
}

function checkOptimizationUnusedImports(program) {
  if (!program) return
  const checker = program.getTypeChecker()
  const optimizationPattern = /\/server\/optimization\//
  for (const sourceFile of program.getSourceFiles()) {
    const filename = sourceFile.fileName.replaceAll('\\', '/')
    if (!optimizationPattern.test(filename) || sourceFile.isDeclarationFile) continue

    const referencedSymbols = new Set()
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node)
        if (symbol) referencedSymbols.add(symbol)
      }
      ts.forEachChild(node, visit)
    }
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) visit(statement)
    }

    for (const declaration of sourceFile.statements.filter(ts.isImportDeclaration)) {
      const clause = declaration.importClause
      if (!clause) continue
      const bindings = []
      if (clause.name) bindings.push(clause.name)
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        bindings.push(clause.namedBindings.name)
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        bindings.push(...clause.namedBindings.elements.map((element) => element.name))
      }
      for (const binding of bindings) {
        const symbol = checker.getSymbolAtLocation(binding)
        if (symbol && referencedSymbols.has(symbol)) continue
        const position = sourceFile.getLineAndCharacterOfPosition(binding.getStart(sourceFile))
        failures.push(`${filename}:${position.line + 1}:${position.character + 1} unused import ${binding.text}`)
      }
    }
  }
}

async function checkProductCatalogOwnership() {
  const duplicatePatterns = [
    [/\[['"]recommended['"],\s*['"]growth['"],\s*['"]advanced['"],\s*['"]ultimate['"]\]/, 'product permission array'],
    [/recommended\s*:\s*['"]单次重置卡['"]/, 'product permission label map'],
    [/ADVANCED_UPDATE_WINDOW_MS\s*=\s*7\s*\*/, 'lifetime update window'],
    [/ADVANCED_UPDATE_MAX_COUNT\s*=\s*2\b/, 'lifetime update count'],
  ]
  for (const root of ['src', 'server']) {
    for await (const filename of glob(`${root}/**/*.{ts,tsx}`)) {
      const normalized = filename.replaceAll('\\', '/')
      if (normalized === 'src/lib/product-catalog.ts' || normalized.includes('.test.')) continue
      const source = await readFile(filename, 'utf8')
      for (const [pattern, label] of duplicatePatterns) {
        if (pattern.test(source)) failures.push(`${filename}: ${label} must come from product/catalog.json`)
      }
    }
  }
}
