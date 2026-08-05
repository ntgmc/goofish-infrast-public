import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import { ts } from 'ts-morph'
import { isPrivateOptimizerSource } from './private-optimizer-sources.mjs'

const failures = []
const publicOnly = process.argv.slice(2).join(' ') === '--scope public'

await checkGlob('server/optimization/**/*.ts', 800)
await checkGlob('src/pages/admin/**/*.ts', 800)
await checkGlob('src/pages/admin/**/*.tsx', 900)
await checkGlob('src/pages/tool/optimize/**/*.ts', 800)
await checkGlob('src/pages/tool/optimize/**/*.tsx', 800)
await checkFile('src/pages/AdminPage.tsx', 400)
await checkFile('src/pages/OptimizePage.tsx', 400)
await checkFile('server/handlers/optimization.ts', 300)
await checkGlob('server/optimization/engine/**/*.ts', 350)
const typeProgram = createArchitectureTypeProgram()
checkNewPageModuleUnusedSymbols(typeProgram)
checkOptimizationUnusedImports(typeProgram)
await checkProductCatalogOwnership()
await checkRadixUiOwnership()
await checkLocalDevelopmentScripts()
await checkPrivateCompositionContract()

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
  if (source.includes('optimize-job-runner')) {
    failures.push(`${filename}: API handler imports optimize job runner directly`)
  }
}

const jobStatusSource = await readFile('server/optimization/jobs/job-status.ts', 'utf8')
if (jobStatusSource.includes('optimize-job-runner')) {
  failures.push('server/optimization/jobs/job-status.ts: job status imports optimize job runner directly')
}

for (const filename of [
  'server/routes.ts',
  'server/handlers/optimization.ts',
  'server/index.ts',
  'server/api-process.ts',
  'server/api-process-hooks.ts',
  'server/optimize-queue-maintenance.ts',
  'server/optimization/jobs/job-status.ts',
  'server/optimization/jobs/reorder-submission.ts',
]) {
  const source = await readFile(filename, 'utf8')
  if (source.includes('optimize-job-runner')) {
    failures.push(`${filename}: public API process boundary imports optimize job runner directly`)
  }
  if (source.includes('optimization/jobs/executor')) {
    failures.push(`${filename}: public API process boundary imports optimize job executor directly`)
  }
  if (source.includes('optimization/engine/')) {
    failures.push(`${filename}: public API process boundary imports optimizer engine directly`)
  }
  if (source.includes('reorder-analysis')) {
    failures.push(`${filename}: public API process boundary imports reorder analysis directly`)
  }
  if (source.includes('reorder-executor')) {
    failures.push(`${filename}: public API process boundary imports reorder worker executor directly`)
  }
}

const privateOptimizerImportPattern = /from\s+['"][^'"]*(?:optimization\/jobs\/(?:executor|reorder-executor|reorder-analysis|result-formatting)|optimization\/scenario-comparison\/service|optimization\/(?:engine|candidates|domain|economics|formatting|rules|solvers)\/)/
for (const filename of [
  'server/optimize-job-runner.ts',
  'server/optimize-worker-process.ts',
  'server/optimize-worker-runtime.ts',
  'server/combined-process-hooks.ts',
  'server/optimize-queue-maintenance.ts',
  'server/api-process.ts',
  'server/api-process-hooks.ts',
  'server/index.ts',
  'server/routes.ts',
  'server/optimization/jobs/optimizer-port.ts',
  'server/optimization/jobs/optimizer-dispatcher.ts',
]) {
  const source = await readFile(filename, 'utf8')
  if (privateOptimizerImportPattern.test(source)) {
    failures.push(`${filename}: public worker/API boundary imports private optimizer implementation`)
  }
}

const privateExecutorCompositionRoots = new Set([
  'server/all.ts',
  'server/worker.ts',
  'server/optimize-worker.ts',
])
for await (const filename of glob('server/**/*.ts')) {
  const normalized = filename.replaceAll('\\', '/')
  if (normalized.endsWith('.test.ts')) continue
  const source = await readFile(filename, 'utf8')
  if (source.includes('optimization/jobs/executor') && !privateExecutorCompositionRoots.has(normalized)) {
    failures.push(`${filename}: only private composition roots may import the optimizer executor`)
  }
}

if (!publicOnly) {
  const privateExecutorSource = await readFile('server/optimization/jobs/executor.ts', 'utf8')
  if (privateExecutorSource.includes('optimize-job-runner')) {
    failures.push('server/optimization/jobs/executor.ts: private optimizer implementation imports the public runner')
  }
} else {
  for await (const filename of glob('server/**/*.ts')) {
    if (isPrivateOptimizerSource(filename)) {
      failures.push(`${filename}: private optimizer source exists in public-only architecture scope`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`architecture error: ${failure}`)
  process.exit(1)
}
console.log(`architecture checks ok (${engineFiles.length} optimization modules, scope=${publicOnly ? 'public' : 'full'})`)

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

async function checkLocalDevelopmentScripts() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const expectedScripts = publicOnly
    ? {
        'build:server': 'npm run build:server:public',
        'start:server': 'npm run build:server && npm run start:api',
        'start:api': 'node --env-file=.env server/dist/index.js',
      }
    : {
        'build:server': 'npm run build:server:release',
        'start:server': 'npm run build:server && npm run start:all',
        'start:api': 'node --env-file=.env server/dist/index.js',
        'start:all': 'node --env-file=.env server/dist/all.js',
      }
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== expected) {
      failures.push(`package.json: ${name} must remain ${JSON.stringify(expected)}`)
    }
  }
}

async function checkPrivateCompositionContract() {
  const contract = JSON.parse(await readFile('optimizer-port-contract.json', 'utf8'))
  const composition = contract.private_composition
  if (contract.optimizer_port_version !== 1) {
    failures.push('optimizer-port-contract.json: optimizer_port_version must match OptimizerPort v1')
  }
  if (composition?.public_source_pin?.kind !== 'git_commit_sha' || composition.public_source_pin.required !== true) {
    failures.push('optimizer-port-contract.json: private composition must require a public git commit SHA')
  }
  for (const [field, expected] of Object.entries({
    entry_points: ['server/worker.ts', 'server/all.ts', 'server/optimize-worker.ts'],
    required_outputs: ['server/dist/worker.js', 'server/dist/all.js', 'server/dist/optimize-worker.js'],
    acceptance_checks: ['worker_startup', 'worker_thread_entry', 'health_ready', 'graceful_shutdown'],
  })) {
    const actual = composition?.[field]
    if (!Array.isArray(actual) || expected.some((value) => !actual.includes(value))) {
      failures.push(`optimizer-port-contract.json: private composition ${field} is incomplete`)
    }
  }
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

async function checkRadixUiOwnership() {
  const directRadixUiExceptions = new Set([
    // The tour owns target-aware positioning, its transparent overlay, and its custom scrim.
    'src/components/GuidedTour.tsx',
  ])

  for await (const filename of glob('src/**/*.{ts,tsx}')) {
    const normalized = filename.replaceAll('\\', '/')
    if (normalized.startsWith('src/components/ui/') || directRadixUiExceptions.has(normalized)) continue

    const source = await readFile(filename, 'utf8')
    const sourceFile = ts.createSourceFile(
      normalized,
      source,
      ts.ScriptTarget.Latest,
      true,
      normalized.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const importsRadixUi = sourceFile.statements.some(
      (statement) => ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === 'radix-ui',
    )
    if (importsRadixUi) {
      failures.push(`${filename}: direct radix-ui imports belong in src/components/ui`)
    }
  }
}
