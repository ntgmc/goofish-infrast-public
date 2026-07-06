import type { LicenseConfig, PermissionMode } from '../../../lib/types'
import ConfigEditor from '../../../components/ConfigEditor'

type WorkspaceConfigSectionProps = {
  config: LicenseConfig
  canEdit: boolean
  canEditIntermediateInventory: boolean
  canSelectPreset: boolean
  changed: boolean
  permission: PermissionMode
  validation: { ok: true } | { ok: false; message: string }
  onUpdate: (mutate: (config: LicenseConfig) => void) => void
}

export default function WorkspaceConfigSection({
  config,
  canEdit,
  canEditIntermediateInventory,
  canSelectPreset,
  changed,
  permission,
  validation,
  onUpdate,
}: WorkspaceConfigSectionProps) {
  return (
    <ConfigEditor
      config={config}
      canEdit={canEdit}
      canEditIntermediateInventory={canEditIntermediateInventory}
      canSelectPreset={canSelectPreset}
      changed={changed}
      permission={permission}
      validation={validation}
      onUpdate={onUpdate}
      note="保存后，下次打开这个账号会自动带上这套配置。"
    />
  )
}
