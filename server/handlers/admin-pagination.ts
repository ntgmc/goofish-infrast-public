const ADMIN_PAGE_SIZES = [25, 50, 100] as const
const MAX_ADMIN_PAGE = 1_000_000

export interface AdminPagination {
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface AdminPageRequest {
  page: number
  pageSize: number
  search: string
}

export interface AdminProfilePageRequest {
  page: number
  pageSize: number
}

export class AdminPaginationError extends Error {}

export function parseAdminPageRequest(url: URL): AdminPageRequest {
  const page = parseInteger(url.searchParams.get('page') ?? '1', 'page')
  const pageSize = parseInteger(url.searchParams.get('page_size') ?? '25', 'page_size')
  if (page < 1) throw new AdminPaginationError('page 必须是大于等于 1 的整数。')
  if (page > MAX_ADMIN_PAGE) throw new AdminPaginationError(`page 不能超过 ${MAX_ADMIN_PAGE}。`)
  if (!(ADMIN_PAGE_SIZES as readonly number[]).includes(pageSize)) {
    throw new AdminPaginationError('page_size 必须是 25、50 或 100。')
  }
  const search = (url.searchParams.get('search') ?? '').trim()
  if (search.length > 100) throw new AdminPaginationError('search 最多允许 100 个字符。')
  return { page, pageSize, search }
}

export function parseAdminProfilePageRequest(url: URL): AdminProfilePageRequest {
  const page = parseInteger(url.searchParams.get('profile_page') ?? '1', 'profile_page')
  const pageSize = parseInteger(url.searchParams.get('profile_page_size') ?? '100', 'profile_page_size')
  if (page < 1) throw new AdminPaginationError('profile_page 必须是大于等于 1 的整数。')
  if (page > MAX_ADMIN_PAGE) throw new AdminPaginationError(`profile_page 不能超过 ${MAX_ADMIN_PAGE}。`)
  if (!(ADMIN_PAGE_SIZES as readonly number[]).includes(pageSize)) {
    throw new AdminPaginationError('profile_page_size 必须是 25、50 或 100。')
  }
  return { page, pageSize }
}

export function buildAdminPagination(page: number, pageSize: number, total: number): AdminPagination {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  return {
    page: totalPages === 0 ? 1 : Math.min(page, totalPages),
    page_size: pageSize,
    total,
    total_pages: totalPages,
  }
}

function parseInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new AdminPaginationError(`${field} 必须是整数。`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new AdminPaginationError(`${field} 必须是安全整数。`)
  return parsed
}
