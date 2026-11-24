import { describe, expect, it } from 'vitest'

import { assignableRoles } from './staffApi'

describe('assignableRoles (mirrors backend canManageRole_)', () => {
  it('owner and platform admin can give every staff role', () => {
    expect(assignableRoles('GYM_OWNER')).toEqual(['GYM_ADMIN', 'TRAINER', 'STAFF'])
    expect(assignableRoles('PLATFORM_ADMIN')).toEqual(['GYM_ADMIN', 'TRAINER', 'STAFF'])
  })
  it('admins can give trainer and staff only', () => {
    expect(assignableRoles('GYM_ADMIN')).toEqual(['TRAINER', 'STAFF'])
  })
  it('everyone else gives nothing; owner is never assignable', () => {
    for (const r of ['STAFF', 'TRAINER', 'MEMBER', undefined])
      expect(assignableRoles(r)).toEqual([])
    expect(assignableRoles('GYM_OWNER')).not.toContain('GYM_OWNER')
  })
})
