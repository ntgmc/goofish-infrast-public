import type { ReactNode } from 'react'
import { copy } from '../../copy'
import type { AssistantCandidate } from '../../lib/workspace-assistant'
import WorkspaceAssistant from './WorkspaceAssistant'

const text = copy.v2.workspaceAssistant

export function ChangeList({ changes }: { changes: AssistantCandidate[] }) {
  if (!changes.length) return <p className="v2-muted">{text.changesEmpty}</p>
  return <ul className="v2-change-items">{changes.map(({ key, title, facts }) => <li key={key}><strong>{title}</strong>{facts.map((fact) => <p key={fact}>{fact}</p>)}</li>)}</ul>
}

export default function AccountChanges({ userId, profileId, changes, visible = true, children }: { userId: string; profileId: string; changes: AssistantCandidate[]; visible?: boolean; children?: ReactNode }) {
  return <div className="v2-change-list">
    <ChangeList changes={changes} />
    {children}
    {changes.length > 1 && <WorkspaceAssistant key={JSON.stringify(changes)} task="changes" userId={userId} profileId={profileId} title={text.changesFocus} description={text.changesHelp} fixedQuestion={text.changesQuestion} visible={visible}
      buildRequest={(question) => ({ task: 'changes', profile_id: profileId, question, candidates: changes.slice(0, 12) })}
      renderReply={(reply) => 'keys' in reply && reply.keys.length ? <><h3>{text.changesResults}</h3><ChangeList changes={reply.keys.flatMap((key) => changes.find((change) => change.key === key) ?? [])} /></> : <p>{text.noneSelected}</p>} />}
  </div>
}
