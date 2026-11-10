import { useEffect, useState } from 'react'
import { DeploymentUpdateDialog } from '../../components/DeploymentUpdatePrompt'
import { copy } from '../../copy'
import { APP_BUILD_META } from '../../lib/build-meta'
import { CHANGELOG_RELEASES } from '../../lib/changelog'
import { useAdminPreviewSession } from './useAdminPreviewSession'

const text = copy.v2.deploymentPreview
const releases = CHANGELOG_RELEASES.filter((release) => release.sections.some((section) => section.items.length > 0)).slice(0, 4)

export default function DeploymentPromptPreview() {
  const authorized = useAdminPreviewSession()
  const [scenario, setScenario] = useState<'update' | 'welcome' | null>(null)
  useEffect(() => { if (!authorized) setScenario(null) }, [authorized])
  if (!authorized) return null
  return <section>
    <h3 className="text-base font-semibold text-ink-primary">{text.title}</h3>
    <p className="mt-2 text-sm leading-6 text-ink-secondary">{text.description}</p>
    <div className="v2-actions mt-4">
      <button type="button" className="v2-button v2-button-secondary" onClick={() => setScenario('update')}>{text.update}</button>
      <button type="button" className="v2-button v2-button-secondary" onClick={() => setScenario('welcome')}>{text.welcome}</button>
    </div>
    {scenario && <DeploymentUpdateDialog
      isWelcome={scenario === 'welcome'}
      previousVersion={releases[3]?.version ?? text.previousVersion}
      promptVersion={releases[0]?.version ?? APP_BUILD_META.frontend_version}
      changelog={{ data: releases.slice(0, scenario === 'welcome' ? 3 : 1) }}
      preview={text}
      onDismiss={() => setScenario(null)}
      onContinue={() => setScenario(scenario === 'update' ? 'welcome' : null)}
    />}
  </section>
}
