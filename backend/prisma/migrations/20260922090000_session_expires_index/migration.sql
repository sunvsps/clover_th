-- Supports the daily purge of expired sessions.
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
