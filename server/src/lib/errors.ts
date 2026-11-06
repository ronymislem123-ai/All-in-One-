export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Nicht angemeldet.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Keine Berechtigung.') => new AppError(403, 'forbidden', message);
export const notFound = (what = 'Objekt') => new AppError(404, 'not_found', `${what} wurde nicht gefunden.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);
export const tooMany = (message = 'Zu viele Anfragen – bitte kurz warten.') => new AppError(429, 'rate_limited', message);
