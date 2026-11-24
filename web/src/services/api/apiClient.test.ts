import { describe, expect, it } from 'vitest'

import { ApiRequestError } from './apiClient'

describe('ApiRequestError', () => {
  it('exposes string field errors only', () => {
    const err = new ApiRequestError(400, 'VALIDATION_FAILED', 'Invalid', {
      fields: { phone: 'Required.', weird: 42 },
    })
    expect(err.fieldErrors).toEqual({ phone: 'Required.' })
  })

  it('handles missing or malformed details', () => {
    expect(new ApiRequestError(500, 'X', 'x').fieldErrors).toEqual({})
    expect(new ApiRequestError(500, 'X', 'x', 'oops').fieldErrors).toEqual({})
    expect(new ApiRequestError(500, 'X', 'x', { fields: null }).fieldErrors).toEqual({})
  })

  it('keeps extra safe details such as the clashing member ID', () => {
    const err = new ApiRequestError(409, 'MEMBER_PHONE_EXISTS', 'Taken', {
      fields: { phone: 'Already used.' },
      memberId: 'MEM-1',
    })
    expect(err.details?.memberId).toBe('MEM-1')
  })
})
