export function downloadLicenseFile(content: string, orderHash: string): void {
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `maa-license-${orderHash.slice(0, 8)}.maa`
  a.click()
  URL.revokeObjectURL(url)
}
