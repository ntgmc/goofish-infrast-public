import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import ts from 'typescript'

const failures = []

runSelfTests()

for await (const filename of glob('src/**/*.{ts,tsx}')) {
  const normalized = filename.replaceAll('\\', '/')
  if (isExcluded(normalized)) continue
  const sourceText = await readFile(filename, 'utf8')
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  visit(sourceFile, sourceFile)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`copy architecture error: ${failure}`)
  process.exitCode = 1
} else {
  console.log('copy architecture checks ok')
}

function visit(node, sourceFile) {
  if (isUserTextNode(node) && /[\u3400-\u9fff]/u.test(node.getText(sourceFile))) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    failures.push(`${sourceFile.fileName}:${position.line + 1}:${position.character + 1} move user-facing Chinese text to src/copy/zh-CN`)
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile))
}

function isUserTextNode(node) {
  if (ts.isJsxText(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return true
  if (!ts.isStringLiteral(node)) return false
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return false
  if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent)) return false
  return true
}

function isExcluded(filename) {
  return filename.startsWith('src/copy/')
    || filename.startsWith('src/pages/admin/')
    || /\.test\.tsx?$/.test(filename)
}

function runSelfTests() {
  const positiveCases = [
    ['src/components/Example.tsx', 'export const Example = () => <button>确认</button>'],
    ['src/lib/example.ts', "export const message = '保存失败'"],
    ['src/lib/example.ts', 'export const message = `已有 ${count} 条记录`'],
  ]
  const negativeCases = [
    ['src/components/Example.tsx', '// 中文注释\nexport const Example = () => <button>Confirm</button>'],
    ['src/components/Example.test.tsx', 'export const message = "测试文案"'],
    ['src/pages/admin/Example.tsx', 'export const message = "管理后台"'],
    ['src/copy/zh-CN/common.ts', 'export const message = "确认"'],
  ]

  for (const [filename, source] of positiveCases) {
    if (inspectSource(filename, source).length === 0) throw new Error(`copy architecture self-test failed to detect ${filename}`)
  }
  for (const [filename, source] of negativeCases) {
    if (inspectSource(filename, source).length > 0) throw new Error(`copy architecture self-test produced a false positive for ${filename}`)
  }
}

function inspectSource(filename, sourceText) {
  if (isExcluded(filename)) return []
  const priorLength = failures.length
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  visit(sourceFile, sourceFile)
  return failures.splice(priorLength)
}
