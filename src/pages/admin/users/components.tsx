import { useEffect, useState, type FormEvent } from 'react'
import type { AdminBalanceTransaction, BalancePage } from '../../../lib/balance-contracts'
import { normalizePointsAmount } from '../../../lib/balance-contracts'
import { AppUserSummary, AdminProfileSummary, AdminUserDetail, AdminProfileOperatorData, permissionLabels, appUserStatusLabels } from '../contracts'
import { AdminDetailDialog } from '../shared/AdminDetailDialog'
import { DetailItem, StatusPill, UserStatusPill, SmallButton, formatDate, getAdminProfileAccessLabel, formatAdminProfileAccess, formatOperatorValue, getAppUserStatusLabel } from '../shared/helpers'
import { adminApiJson } from '../../../lib/admin-api-client'

export interface UserDetailPanelProps {
  detail: AdminUserDetail;
  busyAction: string | null;
  operatorDataByProfileId: Record<string, AdminProfileOperatorData>;
  expandedOperatorProfileId: string | null;
  balance: BalancePage<AdminBalanceTransaction> | null;
  balanceLoading: boolean;
  onClose: () => void;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onUpgradePreviewProfile: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
  onAdjustBalance: (operation: 'credit' | 'debit' | 'reverse_credit', amount: string, reason: string, idempotencyKey: string, originalTransactionId?: string) => Promise<boolean>;
  onLoadMoreBalance: () => Promise<void>;
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

function UserDetailPanel({
  detail,
  busyAction,
  operatorDataByProfileId,
  expandedOperatorProfileId,
  balance,
  balanceLoading,
  onClose,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onUpgradePreviewProfile,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
  onAdjustBalance,
  onLoadMoreBalance,
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
            <UserStatusPill status={user.status} emailVerifiedAt={user.email_verified_at} />
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
          <DetailItem label="账号状态" value={getAppUserStatusLabel(user.status, user.email_verified_at)} />
          <DetailItem label="档案数量" value={String(detail.profiles.length)} />
          <DetailItem label="CDK 订单标识" value={user.cdk_order_hash || '-'} />
          <DetailItem label="创建时间" value={formatDate(user.created_at)} />
          <DetailItem label="更新时间" value={formatDate(user.updated_at)} />
        </dl>

        <UserBalanceCard
          userId={user.id}
          balance={balance}
          loading={balanceLoading}
          busy={busyAction === `user-balance:${user.id}`}
          onAdjust={onAdjustBalance}
          onLoadMore={onLoadMoreBalance}
        />

        <PersonalUseDeclarations declarations={detail.personal_use_declarations} />

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

function UserBalanceCard({
  userId,
  balance,
  loading,
  busy,
  onAdjust,
  onLoadMore,
}: {
  userId: string;
  balance: BalancePage<AdminBalanceTransaction> | null;
  loading: boolean;
  busy: boolean;
  onAdjust: UserDetailPanelProps['onAdjustBalance'];
  onLoadMore: UserDetailPanelProps['onLoadMoreBalance'];
}) {
  const [operation, setOperation] = useState<'credit' | 'debit' | 'reverse_credit'>('credit')
  const [originalTransactionId, setOriginalTransactionId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [validationError, setValidationError] = useState<string | null>(null)

  const resetRequestIdentity = () => setIdempotencyKey(crypto.randomUUID())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedAmount = normalizePointsAmount(amount)
    const normalizedReason = reason.trim()
    if (!normalizedAmount) {
      setValidationError('积分金额必须是 0.01 到 1000000.00 之间、最多两位小数的字符串。')
      return
    }
    if (!normalizedReason || normalizedReason.length > 500) {
      setValidationError('调整原因必填，长度不能超过 500 个字符。')
      return
    }
    if (operation === 'reverse_credit' && !originalTransactionId.trim()) {
      setValidationError('资格冲正必须填写原正向积分交易 ID。')
      return
    }
    setValidationError(null)
    const succeeded = await onAdjust(operation, normalizedAmount, normalizedReason, idempotencyKey, originalTransactionId.trim() || undefined)
    if (!succeeded) return
    setAmount('')
    setReason('')
    resetRequestIdentity()
  }

  return (
    <section className="tool-inset mt-5 p-4" aria-labelledby="admin-user-balance-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="admin-user-balance-title" className="text-sm font-semibold text-ink-primary">积分余额</h3>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-primary">{balance?.balance.available ?? '0.00'}</p>
          <p className="mt-1 text-xs text-ink-muted">可用 {balance?.balance.available ?? '0.00'} · 预留 {balance?.balance.reserved ?? '0.00'} · 待追偿 {balance?.balance.debt ?? '0.00'}</p>
          <p className="mt-1 text-xs text-ink-muted">累计获得 {balance?.balance.lifetime_credited ?? '0.00'} · 资格冲正 {balance?.balance.qualification_reversed ?? '0.00'} · {balance?.balance.commercial?.eligible ? `商用 Lv${balance.balance.commercial.level}` : '商用未生效'}</p>
        </div>
        <span className="tool-status">{balance?.transactions.length ?? 0} 条已加载流水</span>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 lg:grid-cols-[140px_180px_1fr_auto]" noValidate>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">操作</span>
          <select
            value={operation}
            onChange={(event) => { setOperation(event.currentTarget.value as 'credit' | 'debit' | 'reverse_credit'); resetRequestIdentity() }}
            className="tool-field"
          >
            <option value="credit">增加积分</option>
            <option value="debit">扣减积分</option>
            <option value="reverse_credit">资格冲正</option>
          </select>
        </label>
        {operation === 'reverse_credit' && <label className="lg:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">原正向交易 ID</span>
          <input value={originalTransactionId} onChange={(event) => { setOriginalTransactionId(event.currentTarget.value); resetRequestIdentity() }} className="tool-field font-mono" />
        </label>}
        <label>
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">金额</span>
          <input
            value={amount}
            onChange={(event) => { setAmount(event.currentTarget.value); resetRequestIdentity() }}
            inputMode="decimal"
            placeholder="例如 12.30"
            className="tool-field"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">内部原因（必填）</span>
          <input
            value={reason}
            onChange={(event) => { setReason(event.currentTarget.value); resetRequestIdentity() }}
            maxLength={500}
            placeholder="仅管理员审计可见"
            className="tool-field"
          />
        </label>
        <button type="submit" disabled={busy} className={operation === 'credit' ? 'tool-primary-action self-end' : 'tool-danger-action self-end'}>
          {busy ? '处理中…' : operation === 'credit' ? '增加' : operation === 'debit' ? '扣减' : '冲正'}
        </button>
      </form>
      {validationError && <p className="mt-2 text-sm text-error" role="alert">{validationError}</p>}

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-xs text-ink-secondary">
          <thead className="border-b border-surface-3 text-ink-muted">
            <tr>
              <th className="px-2 py-2 font-medium">类型</th>
              <th className="px-2 py-2 font-medium">变动</th>
              <th className="px-2 py-2 font-medium">余额</th>
              <th className="px-2 py-2 font-medium">管理员 / 原因</th>
              <th className="px-2 py-2 font-medium">引用</th>
              <th className="px-2 py-2 font-medium">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {(balance?.transactions ?? []).map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-2 py-2">{adminBalanceKindLabel(transaction.kind)}</td>
                <td className={`px-2 py-2 font-mono font-medium ${transaction.amount.startsWith('-') ? 'text-error' : 'text-success'}`}>{transaction.amount.startsWith('-') ? transaction.amount : `+${transaction.amount}`}</td>
                <td className="px-2 py-2 font-mono">{transaction.balance_after}</td>
                <td className="max-w-72 px-2 py-2"><div>{transaction.admin_username ?? '-'}</div><div className="truncate text-ink-muted" title={transaction.reason ?? undefined}>{transaction.reason ?? '-'}</div></td>
                <td className="max-w-52 px-2 py-2 font-mono text-ink-muted"><div>{transaction.reference_type}</div><div className="truncate" title={transaction.reference_id}>{transaction.reference_id}</div></td>
                <td className="whitespace-nowrap px-2 py-2">{formatDate(transaction.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!balance?.transactions.length && <p className="py-6 text-center text-sm text-ink-muted">暂无积分流水。</p>}
      </div>
      {balance?.next_cursor && (
        <button type="button" onClick={() => void onLoadMore()} disabled={loading} className="tool-secondary-action mt-3 text-sm">
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
      <CommercialAdminControls
        userId={userId}
        eligible={balance?.balance.commercial.eligible === true}
      />
    </section>
  )
}

export function CommercialAdminControls({ userId, eligible }: { userId: string; eligible: boolean }) {
  if (!eligible) return null
  return <EffectiveCommercialAdminControls userId={userId} />
}

function EffectiveCommercialAdminControls({ userId }: { userId: string }) {
  type Limits = { active: number; total: number; active_limit: number; total_limit: number; suspended: boolean; suspension_reason: string | null }
  const [limits, setLimits] = useState<Limits | null>(null)
  const [activeLimit, setActiveLimit] = useState('100')
  const [totalLimit, setTotalLimit] = useState('1000')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const data = await adminApiJson<{ limits: Limits }>(`/api/admin/commercial?user_id=${encodeURIComponent(userId)}`)
    setLimits(data.limits); setActiveLimit(String(data.limits.active_limit)); setTotalLimit(String(data.limits.total_limit)); setReason(data.limits.suspension_reason ?? '')
  }
  useEffect(() => { void load().catch(() => undefined) }, [userId])
  const save = async (suspended = limits?.suspended ?? false) => {
    setBusy(true); setError(null)
    try {
      const data = await adminApiJson<{ limits: Limits }>('/api/admin/commercial', {
        method: 'POST', json: { user_id: userId, active_profile_limit: Number(activeLimit), total_profile_limit: Number(totalLimit), suspended, reason },
      })
      setLimits(data.limits)
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="mt-5 border-t border-surface-3 pt-4">
    <h4 className="text-sm font-semibold text-ink-primary">商用账户控制</h4>
    <p className="mt-1 text-xs text-ink-muted">档案用量：活跃 {limits?.active ?? 0} / {limits?.active_limit ?? 100}，总量 {limits?.total ?? 0} / {limits?.total_limit ?? 1000}；状态：{limits?.suspended ? '已暂停' : '正常'}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-3"><input aria-label="商用活跃档案上限" value={activeLimit} onChange={(event) => setActiveLimit(event.currentTarget.value)} className="tool-field" inputMode="numeric" /><input aria-label="商用档案总量上限" value={totalLimit} onChange={(event) => setTotalLimit(event.currentTarget.value)} className="tool-field" inputMode="numeric" /><input aria-label="暂停原因" value={reason} onChange={(event) => setReason(event.currentTarget.value)} className="tool-field" placeholder="暂停时填写原因" /></div>
    <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="tool-secondary-action">保存限额</button><button type="button" disabled={busy} onClick={() => void save(!limits?.suspended)} className={limits?.suspended ? 'tool-primary-action' : 'tool-danger-action'}>{limits?.suspended ? '恢复商用' : '暂停商用'}</button></div>
    {error && <p className="mt-2 text-sm text-error">{error}</p>}
  </div>
}

function adminBalanceKindLabel(kind: AdminBalanceTransaction['kind']): string {
  if (kind === 'cdk_credit') return '余额 CDK'
  if (kind === 'admin_debit') return '管理员扣减'
  if (kind === 'schedule_debit') return '成功主排班'
  if (kind === 'admin_credit_reversal') return '资格冲正'
  if (kind === 'debt_repayment') return '待追偿抵扣'
  return '管理员发放'
}

function PersonalUseDeclarations({ declarations }: { declarations: AdminUserDetail['personal_use_declarations'] }) {
  return (
    <section className="tool-inset mt-5 p-4" aria-labelledby="personal-use-declarations-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="personal-use-declarations-title" className="text-sm font-semibold text-ink-primary">个人使用声明确认</h3>
        <span className="tool-status">{declarations.length} 条记录</span>
      </div>
      {declarations.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">暂无个人使用声明确认记录。</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs text-ink-secondary">
            <thead className="border-b border-surface-3 text-ink-muted">
              <tr>
                <th className="px-2 py-2 font-medium">版本</th>
                <th className="px-2 py-2 font-medium">触发操作</th>
                <th className="px-2 py-2 font-medium">档案</th>
                <th className="px-2 py-2 font-medium">IP</th>
                <th className="px-2 py-2 font-medium">确认时间</th>
                <th className="px-2 py-2 font-medium">保留至</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {declarations.map((declaration) => (
                <tr key={`${declaration.declaration_id}-${declaration.accepted_at}`}>
                  <td className="px-2 py-2 font-mono">{declaration.declaration_version}</td>
                  <td className="px-2 py-2">{personalUseActionLabel(declaration.action)}</td>
                  <td className="max-w-40 truncate px-2 py-2 font-mono" title={declaration.profile_id ?? undefined}>{declaration.profile_id ?? '-'}</td>
                  <td className="px-2 py-2 font-mono">{declaration.client_ip}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatDate(declaration.accepted_at)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatDate(declaration.retain_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const PERSONAL_USE_ACTION_LABELS: Record<AdminUserDetail['personal_use_declarations'][number]['action'], string> = {
  free_preview_claim: '领取免费权益',
  metered_personal_create: '创建/转换个人按次档案',
  generated_result_export: '导出生成结果',
  optimization_generate: '生成排班结果',
  reorder_check: '调序检查',
}

export function personalUseActionLabel(action: AdminUserDetail['personal_use_declarations'][number]['action']): string {
  return PERSONAL_USE_ACTION_LABELS[action] ?? action
}

function ProfileDetailCard({
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

function ProfileOperatorsPanel({ data }: { data: AdminProfileOperatorData }) {
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
