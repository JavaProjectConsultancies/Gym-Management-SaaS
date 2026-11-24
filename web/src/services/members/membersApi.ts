import type { ApiCaller } from '@/hooks/useApi'
import { invalidateCache, writeCache } from '@/services/cache'
import type { Member, MemberListQuery, MemberListResponse, MemberStatus } from '@/types/member'

/**
 * Members endpoints (docs/API_DOCUMENTATION.md). The gym ID comes from the
 * backend session; the backend re-checks that the caller belongs to that gym.
 */

const base = (gymId: string) => `/gyms/${gymId}/members`

/** Cache keys for screens (services/cache.ts). */
export const memberCacheKeys = {
  list: (gymId: string, rest: string) => `members:list:${gymId}:${rest}`,
  member: (gymId: string, memberId: string) => `member:${gymId}/${memberId}`,
}

/** After a write: lists are stale, the member itself is known. */
function afterWrite(gymId: string, member: Member) {
  invalidateCache(`members:list:${gymId}:`, `memberships:list:${gymId}:`)
  writeCache(memberCacheKeys.member(gymId, member.memberId), member)
}

/** GET with parameters in the body (Apps Script paths cannot carry a query string). */
export function listMembers(
  api: ApiCaller,
  gymId: string,
  query: MemberListQuery,
  signal?: AbortSignal,
): Promise<MemberListResponse> {
  const body: Record<string, unknown> = {}
  if (query.search?.trim()) body.search = query.search.trim()
  if (query.status) body.status = query.status
  if (query.page) body.page = query.page
  if (query.pageSize) body.pageSize = query.pageSize
  if (query.trainerId) body.trainerId = query.trainerId
  return api<MemberListResponse>('GET', base(gymId), body, signal)
}

export async function getMember(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<Member> {
  const res = await api<{ member: Member }>('GET', `${base(gymId)}/${memberId}`, undefined, signal)
  return res.member
}

export async function createMember(
  api: ApiCaller,
  gymId: string,
  payload: Record<string, string>,
): Promise<Member> {
  const res = await api<{ member: Member }>('POST', base(gymId), payload)
  afterWrite(gymId, res.member)
  return res.member
}

export async function updateMember(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  payload: Record<string, string>,
): Promise<Member> {
  const res = await api<{ member: Member }>('PATCH', `${base(gymId)}/${memberId}`, payload)
  afterWrite(gymId, res.member)
  return res.member
}

export function setMemberStatus(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  status: MemberStatus,
): Promise<Member> {
  return updateMember(api, gymId, memberId, { status })
}

/** Member IDs are validated before being put into a path. */
export const MEMBER_ID_PATTERN = /^MEM-[0-9a-f]{32}$/
