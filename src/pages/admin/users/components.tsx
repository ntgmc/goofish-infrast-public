import { AppUserSummary, AdminProfileSummary, AdminUserDetail, AdminProfileOperatorData, permissionLabels, appUserStatusLabels } from '../contracts'
import { AdminDetailDialog } from '../shared/AdminDetailDialog'
import { DetailItem, StatusPill, UserStatusPill, SmallButton, formatDate, getAdminProfileAccessLabel, formatAdminProfileAccess, formatOperatorValue } from '../shared/helpers'

export interface UserDetailPanelProps {
  detail: AdminUserDetail;
  busyAction: string | null;
  operatorDataByProfileId: Record<string, AdminProfileOperatorData>;
  expandedOperatorProfileId: string | null;
  onClose: () => void;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onUpgradePreviewProfile: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
  onFreezeUser: (user: AppUserSummary) => Promise<void>;
  onUnfreezeUser: (user: AppUserSummary) => Promise<void>;
  onDeleteUser: (user: AppUserSummary) => Promise<void>;
}

export function UserDetailDialog(props: UserDetailPanelProps) {
  return (
    <AdminDetailDialog labelledBy="admin-user-detail-title" onClose={props.onClose}>
      <UserDetailPanel {...props} />
    </AdminDetailDialog>
  )
}

export function UserDetailPanel({
  detail,
  busyAction,
  operatorDataByProfileId,
  expandedOperatorProfileId,
  onClose,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onUpgradePreviewProfile,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
  onFreezeUser,
  onUnfreezeUser,
  onDeleteUser,
}: UserDetailPanelProps) {
  const user = detail.user
  return (
    <section className="tool-panel overflow-hidden">
      <div className="tool-panel-header flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="admin-user-detail-title" className="break-all text-lg font-semibold text-ink-primary">{user.email}</h2>
            <UserStatusPill status={user.status} />
            <span className="tool-status tool-status--current">{formatAdminProfileAccess(user.profile_access)}</span>
          </div>
          <p className="mt-2 break-all text-sm text-ink-muted">用户 ID：{user.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.status === 'active' && <SmallButton onClick={() => void onFreezeUser(user)} loading={busyAction === `app-user:freeze_account:${user.id}`}>冻结用户</SmallButton>}
          {user.status === 'frozen' && <SmallButton onClick={() => void onUnfreezeUser(user)} loading={busyAction === `app-user:unfreeze_account:${user.id}`} tone="success">解冻用户</SmallButton>}
          <SmallButton onClick={() => void onDeleteUser(user)} loading={busyAction === `app-user:delete_account:${user.id}`} tone="danger">删除用户</SmallButton>
          <SmallButton onClick={onClose} autoFocus>关闭</SmallButton>
        </div>
      </div>

      <div className="p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem label="账号状态" value={appUserStatusLabels[user.status]} />
          <DetailItem label="档案数量" value={String(detail.profiles.length)} />
          <DetailItem label="CDK 订单标识" value={user.cdk_order_hash || '-'} />
          <DetailItem label="创建时间" value={formatDate(user.created_at)} />
          <DetailItem label="更新时间" value={formatDate(user.updated_at)} />
        </dl>

        <div className="mt-5 space-y-4">
          {detail.profiles.length === 0 ? (
            <div className="tool-inset border-dashed px-4 py-8 text-center text-sm text-ink-muted">该用户暂无档案。</div>
          ) : detail.profiles.map((profile) => (
            <ProfileDetailCard
              key={profile.id}
              profile={profile}
              busyAction={busyAction}
              operatorData={operatorDataByProfileId[profile.id] ?? null}
              operatorsExpanded={expandedOperatorProfileId === profile.id}
              onUpdateProfile={onUpdateProfile}
              onSetProfileStatus={onSetProfileStatus}
              onSetProfilePermission={onSetProfilePermission}
              onUpgradePreviewProfile={onUpgradePreviewProfile}
              onClearSklandBinding={onClearSklandBinding}
              onClearWorkspace={onClearWorkspace}
              onViewOperators={onViewOperators}
              onDownloadOperators={onDownloadOperators}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export function ProfileDetailCard({
  profile,
  busyAction,
  operatorData,
  operatorsExpanded,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onUpgradePreviewProfile,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
}: {
  profile: AdminProfileSummary;
  busyAction: string | null;
  operatorData: AdminProfileOperatorData | null;
  operatorsExpanded: boolean;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onUpgradePreviewProfile: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
}) {
  const sklandSummary = profile.skland_binding
    ? `${profile.skland_binding.nickname || '-'} / ${profile.skland_binding.uid} / ${profile.skland_binding.channel_name || '-'}`
    : profile.skland_pending_binding
      ? `待确认：${profile.skland_pending_binding.nickname || '-'} / ${profile.skland_pending_binding.uid}`
      : '-'
  const riskCount = profile.skland_risk?.uid_mismatch_count ?? 0
  return (
    <article className="tool-inset p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink-primary">{profile.display_name || '账号档案'}</h3>
            <UserStatusPill status={profile.status} />
            <span className="tool-status tool-status--current">{getAdminProfileAccessLabel(profile)}</span>
          </div>
          <p className="mt-2 break-all text-xs text-ink-muted">档案 ID：{profile.id}</p>
          {profile.note && <p className="mt-2 text-sm text-ink-secondary">{profile.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => void onUpdateProfile(profile)} loading={busyAction === `profile:update_profile:${profile.id}`}>改名称</SmallButton>
          <SmallButton onClick={() => void onSetProfileStatus(profile)} loading={busyAction === `profile:set_profile_status:${profile.id}`}>改状态</SmallButton>
          <SmallButton onClick={() => void onSetProfilePermission(profile)} loading={busyAction === `profile:set_profile_permission:${profile.id}`}>改权限</SmallButton>
          {profile.kind === 'free_preview' && <SmallButton onClick={() => void onUpgradePreviewProfile(profile)} loading={busyAction === `profile:upgrade_preview_profile:${profile.id}`} tone="success">免 CDK 升级</SmallButton>}
          <SmallButton onClick={() => void onViewOperators(profile)} loading={busyAction === `profile-operators:${profile.id}`}>{operatorsExpanded ? '收起干员' : '查看干员'}</SmallButton>
          <SmallButton onClick={() => void onDownloadOperators(profile)} loading={busyAction === `profile-operators-download:${profile.id}`}>下载 JSON</SmallButton>
          <SmallButton onClick={() => void onClearSklandBinding(profile)} loading={busyAction === `profile:clear_profile_skland_binding:${profile.id}`} tone="danger">清绑定</SmallButton>
          <SmallButton onClick={() => void onClearWorkspace(profile)} loading={busyAction === `profile:clear_profile_workspace:${profile.id}`} tone="danger">清工作区</SmallButton>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem label="档案类型" value={profile.kind} />
        <DetailItem label="CDK 订单标识" value={profile.cdk_order_hash || profile.cdk?.license_order_hash || '-'} />
        <DetailItem label="森空岛绑定" value={sklandSummary} />
        <DetailItem label="绑定时间" value={formatDate(profile.skland_binding?.bound_at ?? null)} />
        <DetailItem label="最近导入" value={formatDate(profile.skland_binding?.last_imported_at ?? null)} />
        <DetailItem label="风险计数" value={String(riskCount)} />
        <DetailItem label="工作区存在" value={profile.workspace.exists ? '是' : '否'} />
        <DetailItem label="工作区干员" value={String(profile.workspace.operator_count)} />
        <DetailItem label="拥有干员" value={String(profile.operator_count)} />
        <DetailItem label="配置摘要" value={profile.workspace.config_desc || '-'} />
        <DetailItem label="最近结果" value={profile.workspace.has_last_result ? (profile.workspace.last_result_title || '有结果') : '无结果'} />
        <DetailItem label="结果更新时间" value={formatDate(profile.workspace.updated_at)} />
      </dl>

      {profile.cdk && (
        <div className="tool-inset mt-4 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-ink-primary">{profile.cdk.cdk_id}</span>
            <StatusPill status={profile.cdk.status} />
            <span className="text-ink-secondary">{permissionLabels[profile.cdk.permission]}</span>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
            <span>备注：{profile.cdk.order_note || '-'}</span>
            <span>风险：{profile.cdk.risk_event_count}</span>
          </div>
        </div>
      )}
      {operatorsExpanded && operatorData && <ProfileOperatorsPanel data={operatorData} />}
    </article>
  )
}

export function ProfileOperatorsPanel({ data }: { data: AdminProfileOperatorData }) {
  const operators = data.operators
  const sklandSummary = data.profile.skland_binding
    ? `${data.profile.skland_binding.nickname || '-'} / ${data.profile.skland_binding.uid} / ${data.profile.skland_binding.channel_name || '-'}`
    : '-'
  return (
    <div className="mt-4 border-t border-surface-3 pt-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-ink-primary">森空岛干员数据</h4>
          <p className="mt-1 text-xs text-ink-muted">生成时间：{formatDate(data.generated_at)}</p>
        </div>
        <div className="grid gap-2 text-xs text-ink-secondary sm:grid-cols-3 lg:min-w-[420px]">
          <span className="tool-status">总记录 {data.total_operator_records}</span>
          <span className="tool-status tool-status--success">拥有 {data.owned_operator_count}</span>
          <span className="tool-status">更新 {formatDate(data.profile.workspace_updated_at)}</span>
        </div>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem label="档案" value={data.profile.display_name || data.profile.id} />
        <DetailItem label="档案状态" value={appUserStatusLabels[data.profile.status]} />
        <DetailItem label="森空岛绑定" value={sklandSummary} />
      </dl>
      <div className="tool-inset mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">干员</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">拥有</th>
              <th className="px-3 py-2">精英化</th>
              <th className="px-3 py-2">等级</th>
              <th className="px-3 py-2">稀有度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {operators.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-muted">该档案暂无干员数据。</td></tr>
            ) : operators.map((operator, index) => (
              <tr key={`${operator.id}-${index}`} className="hover:bg-surface-2/50">
                <td className="px-3 py-2 font-medium text-ink-primary">{operator.name || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-muted">{operator.id || '-'}</td>
                <td className="px-3 py-2 text-ink-secondary">{operator.own === false ? '否' : '是'}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.elite)}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.level)}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.rarity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
