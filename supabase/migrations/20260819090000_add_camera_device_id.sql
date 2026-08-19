/* Store the browser camera device assigned to a configured camera. */
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS device_id text;