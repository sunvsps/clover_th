-- Job labels are unique case-insensitively and NFC-normalized, like IGNs (user decision).
-- The exact-match unique index "Job_label_key" from the schema stays; this adds the stricter rule.
CREATE UNIQUE INDEX "job_label_ci" ON "Job" (lower(normalize("label", NFC)));
