import type { ApiResponse, FieldErrors, HttpMethod } from '@/types/api'

/**
 * Client for the Apps Script backend.
 *
 * Apps Script web apps accept only GET/POST, cannot read request headers and
 * always answer HTTP 200, so every call is a POST whose JSON body carries the
 * logical method, path and Firebase ID token. `text/plain` avoids a CORS
 * preflight, which Apps Script cannot answer.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

export const isApiConfigured = API_BASE_URL !== ''

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  /** Optional safe details from the backend, e.g. `{ fields: { phone: '…' } }`. */
  readonly details: Record<string, unknown> | undefined

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details =
      details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined
  }

  /** Per-field validation messages, keyed by request field name. */
  get fieldErrors(): FieldErrors {
    const fields = this.details?.fields
    if (!fields || typeof fields !== 'object') return {}
    return Object.fromEntries(
      Object.entries(fields as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  }
}

interface RequestOptions {
  idToken?: string | null
  body?: Record<string, unknown>
  signal?: AbortSignal
}

export async function apiRequest<T>(
  method: HttpMethod,
  path: string,
  { idToken, body, signal }: RequestOptions = {},
): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiRequestError(0, 'API_NOT_CONFIGURED', 'The backend URL is not configured.')
  }

  let response: Response
  try {
    response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, path, idToken: idToken ?? undefined, body }),
      redirect: 'follow',
      signal,
    })
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Unable to reach the server.')
  }

  let payload: ApiResponse<T>
  try {
    payload = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an invalid response.',
    )
  }

  if (!payload.ok) {
    throw new ApiRequestError(
      payload.status,
      payload.error.code,
      payload.error.message,
      payload.error.details,
    )
  }
  return payload.data
}
