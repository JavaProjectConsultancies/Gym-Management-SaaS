import { ApiRequestError } from '@/services/api/apiClient'

/** A message that is safe and useful to show to the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return 'Cannot reach the server. Check your internet connection and try again.'
      case 'API_NOT_CONFIGURED':
        return 'The backend URL is not configured (VITE_API_BASE_URL).'
      case 'LOCK_TIMEOUT':
        return 'The server is busy. Please try again in a moment.'
      default:
        return error.message
    }
  }
  return 'Something went wrong. Please try again.'
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
