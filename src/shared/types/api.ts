export interface AppError {
  code: string
  message: string
  details?: unknown
}

export type ApiResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: AppError
    }

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function fail(code: string, message: string, details?: unknown): ApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  }
}

