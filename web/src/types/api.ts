/** Response envelope returned by the Apps Script backend (see docs/API_DOCUMENTATION.md). */
export type ApiResponse<T> =
  | { ok: true; status: number; data: T; requestId: string; timestamp: string }
  | {
      ok: false
      status: number
      error: { code: string; message: string; details?: unknown }
      requestId: string
      timestamp: string
    }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface SessionResponse {
  user: {
    userId: string
    email: string
    fullName: string
    role: string
    status: string
    gymId: string | null
  }
  gym: {
    gymId: string
    name: string
    status: string
    createdAt: string
    /** `false` until the gym's own spreadsheet has been set up by an administrator. */
    dataStoreReady: boolean
  } | null
  permissions: string[]
}

/** Field-level validation errors returned with 400 / 409 responses. */
export type FieldErrors = Record<string, string>

/** Paginated list envelope used by list endpoints. */
export interface PageInfo {
  page: number
  pageSize: number
  total: number
}
