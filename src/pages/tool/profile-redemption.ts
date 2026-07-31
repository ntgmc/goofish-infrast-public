import type { AuthSuccessResponse } from '../../lib/types'
import { apiJson } from '../../lib/api-client'

type ProfileRedemptionResponse =
  | { redemption_type: 'profile'; auth: AuthSuccessResponse }
  | { redemption_type: 'inventory' }

export async function upgradeProfileWithCdk(options: {
  profileId: string
  cdk: string
  idempotencyKey: string
  fallbackMessage: string
}): Promise<AuthSuccessResponse> {
  const response = await apiJson<ProfileRedemptionResponse>('/api/user/cdk/redeem', {
    method: 'POST',
    json: {
      profile_id: options.profileId,
      cdk: options.cdk,
      idempotency_key: options.idempotencyKey,
    },
    fallbackMessage: options.fallbackMessage,
  })
  if (response.redemption_type !== 'profile') {
    throw new Error('当前 CDK 不能用于升级档案。')
  }
  return response.auth
}
