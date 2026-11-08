-- Prix Malin — mesure v2 (sessions, déduplication, classification du trafic, rapport Amazon).
-- ADDITIVE UNIQUEMENT : aucune table ni colonne ni donnée n'est supprimée ou modifiée.
-- Les lignes existantes gardent leurs valeurs ; les nouvelles colonnes y valent NULL.
--
-- À exécuter UNE fois, par le propriétaire, après vérification du schéma réel (voir 0000-schema-reference.sql) :
--   1. Sauvegarde :  npx wrangler d1 export prixbasmalin-clicks --remote --output=backup-avant-v2.sql
--   2. Migration :   npx wrangler d1 execute prixbasmalin-clicks --remote --file=migrations/2026-11-08-analytics-v2.sql
--   3. Déployer ensuite workers/prixbasmalin-clicks.js (il fonctionne aussi avant la migration, en mode historique).
-- Retour arrière : redéployer l'ancienne version du Worker ; les colonnes ajoutées sont ignorées par l'ancien code.
-- La base peut aussi être restaurée à un instant donné avec D1 Time Travel (inclus, gratuit) :
--   npx wrangler d1 time-travel restore prixbasmalin-clicks --timestamp=<horodatage avant migration>

-- Pages vues
ALTER TABLE page_views ADD COLUMN session_id TEXT;
ALTER TABLE page_views ADD COLUMN event_id TEXT;
ALTER TABLE page_views ADD COLUMN source TEXT;
ALTER TABLE page_views ADD COLUMN medium TEXT;
ALTER TABLE page_views ADD COLUMN campaign TEXT;
ALTER TABLE page_views ADD COLUMN country TEXT;
ALTER TABLE page_views ADD COLUMN product_id TEXT;
ALTER TABLE page_views ADD COLUMN traffic_class TEXT;
ALTER TABLE page_views ADD COLUMN schema_version INTEGER;

-- Clics sortants
ALTER TABLE outbound_clicks ADD COLUMN has_affiliate_tag INTEGER;
ALTER TABLE outbound_clicks ADD COLUMN visitor_id TEXT;
ALTER TABLE outbound_clicks ADD COLUMN session_id TEXT;
ALTER TABLE outbound_clicks ADD COLUMN event_id TEXT;
ALTER TABLE outbound_clicks ADD COLUMN product_id TEXT;
ALTER TABLE outbound_clicks ADD COLUMN link_kind TEXT;
ALTER TABLE outbound_clicks ADD COLUMN traffic_class TEXT;
ALTER TABLE outbound_clicks ADD COLUMN country TEXT;
ALTER TABLE outbound_clicks ADD COLUMN schema_version INTEGER;

-- Déduplication : un même événement (double envoi, nouvelle tentative) n'est enregistré qu'une fois.
-- Les anciennes lignes ont event_id NULL : SQLite autorise plusieurs NULL dans un index unique.
CREATE UNIQUE INDEX IF NOT EXISTS ux_page_views_event_id ON page_views(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_outbound_clicks_event_id ON outbound_clicks(event_id);
-- Les index created_at existent déjà dans la base de production ; ne pas en ajouter de doublons.

-- Rapports officiels Amazon Partenaires importés manuellement (scripts/import_amazon_report.py).
-- Aucune donnée n'y est jamais déduite des clics.
CREATE TABLE IF NOT EXISTS amazon_reports (
  report_date TEXT NOT NULL,
  tracking_id TEXT NOT NULL,
  clicks INTEGER,
  ordered_items INTEGER,
  shipped_items INTEGER,
  returned_items INTEGER,
  revenue_eur REAL,
  earnings_eur REAL,
  source_file TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_date, tracking_id)
);
