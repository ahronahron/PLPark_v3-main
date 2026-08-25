ALTER TABLE cameras ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'device';