/** Stable error codes (design 6.8). The frontend translates by `code`. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const errors = {
  authRequired: () => new AppError('AUTH_REQUIRED', 401, 'Sign in required'),
  adminRequired: () => new AppError('ADMIN_REQUIRED', 403, 'Admin only'),
  botKeyInvalid: () => new AppError('BOT_KEY_INVALID', 401, 'Missing or invalid bot key'),
  csrfRejected: () => new AppError('CSRF_REJECTED', 403, 'Cross-site request rejected'),
  oauthFailed: (why = 'OAuth exchange failed') => new AppError('AUTH_OAUTH_FAILED', 400, why),
  invalidJob: () => new AppError('INVALID_JOB', 422, 'Job is missing or not in the job list'),
  duplicateIgn: () => new AppError('DUPLICATE_IGN', 409, 'In-game name is already used by an active member'),
  cannotDeactivateSelf: () =>
    new AppError('CANNOT_DEACTIVATE_SELF', 409, 'You cannot deactivate your own account'),
  memberNotFound: () => new AppError('MEMBER_NOT_FOUND', 404, 'Member not found'),
  serviceBusy: () => new AppError('SERVICE_BUSY', 503, 'Service busy, please retry'),
};

/** Needles identifying the IGN unique index: its name and its expression (Prisma reports only the expression). */
export const IGN_INDEX = ['member_ign_active', 'normalize(ign'] as const;
