import * as esbuild from 'esbuild'

const entries = [
  'server/handlers/optimization.ts',
  'server/handlers/admin-cdk.ts',
  'server/handlers/admin-users.ts',
  'server/handlers/user-status.ts',
]

const forbiddenInput = /(?:^|\/)(?:all|worker|optimize-worker)\.ts$|optimization\/(?:engine|candidates|domain|economics|formatting|rules|solvers|scenario-comparison)\/|optimization\/jobs\/(?:executor|result-formatting)\.ts$/
const forbiddenContent = /OptimizerEngine|optimization\/jobs\/(?:executor|result-formatting)|optimization\/(?:engine|candidates|domain|economics|formatting|rules|solvers|scenario-comparison)\//

for (const entryPoint of entries) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    logLevel: 'silent',
  })
  const inputs = Object.keys(result.metafile.inputs).map((path) => path.replaceAll('\\', '/'))
  const forbidden = inputs.find((path) => forbiddenInput.test(path))
  if (forbidden) throw new Error(`${entryPoint}: bundled private optimizer input ${forbidden}`)
  const output = result.outputFiles.map((file) => file.text).join('\n')
  if (forbiddenContent.test(output)) throw new Error(`${entryPoint}: bundled private optimizer content`)
}

console.log('api handler bundle boundaries ok')
