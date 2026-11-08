-- RÉFÉRENCE UNIQUEMENT — NE PAS EXÉCUTER EN PRODUCTION.
-- Schéma de base de référence de la base D1 « prixbasmalin-clicks ».
-- Les tables et index ci-dessous ont été vérifiés en lecture seule dans D1 le 08/11/2026.
-- La colonne country de traffic_attribution est ajoutée par la migration du 06/11/2026.
-- Ce fichier sert aux tests automatiques, pas à recréer la base.
-- Vérifier le schéma réel, en lecture seule, avant toute migration :
--   npx wrangler d1 execute prixbasmalin-clicks --remote --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index')"
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_path TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS outbound_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_path TEXT NOT NULL,
  merchant_host TEXT NOT NULL,
  click_type TEXT NOT NULL,
  affiliate_tag TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS traffic_attribution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_path TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clicks_created ON outbound_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_created_at ON outbound_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_merchant ON outbound_clicks(merchant_host);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(visitor_id);
-- Puis : migrations/2026-11-06-traffic-attribution-country.sql (colonne country).
