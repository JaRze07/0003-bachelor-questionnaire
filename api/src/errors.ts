export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: Record<string, unknown>) {
    super(message ?? code);
  }
}
export const badRequest = (code: string, message?: string, details?: Record<string, unknown>) => new ApiError(400, code, message, details);
export const unauthorized = (code = 'unauthorized') => new ApiError(401, code);
export const forbidden = (code: string, message?: string) => new ApiError(403, code, message);
export const notFound = (code = 'not_found') => new ApiError(404, code);
export const conflict = (code: string, message?: string, details?: Record<string, unknown>) => new ApiError(409, code, message, details);
export const gone = (code = 'game_deleted') => new ApiError(410, code);
export const tooMany = (retryAfterSec: number) => new ApiError(429, 'rate_limited', undefined, { retryAfterSec });
