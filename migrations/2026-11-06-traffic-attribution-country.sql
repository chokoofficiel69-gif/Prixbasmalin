-- Run once against the existing Prix Malin CLICKS D1 database.
-- Country is derived from Cloudflare request metadata; no IP address is stored.
ALTER TABLE traffic_attribution ADD COLUMN country TEXT;
