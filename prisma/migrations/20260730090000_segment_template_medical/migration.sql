-- Adds the `medical` segment template (field teams visiting doctors/medical
-- staff). Additive enum change: existing tenants and reports are untouched.
ALTER TYPE "SegmentTemplate" ADD VALUE 'medical';
