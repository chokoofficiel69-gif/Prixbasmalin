-- RÉFÉRENCE UNIQUEMENT — NE PAS EXÉCUTER EN PRODUCTION.
-- Schéma de base présumé de la base D1 « prixbasmalin-clicks », déduit du code des Workers
-- (aucun fichier de création n'était versionné). Il sert aux tests automatiques.
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
-- Puis : migrations/2026-11-06-traffic-attribution-country.sql (colonne country).
