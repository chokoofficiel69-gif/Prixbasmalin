from pathlib import Path
import unittest


class ProductionMonitorWorkflowTests(unittest.TestCase):
    def test_monitor_runs_after_data_workflows_complete_on_main(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("  workflow_run:", workflow)
        for name in (
            "pages build and deployment",
            "Importer les catalogues Rakuten autorisés",
            "Synchroniser le catalogue produits Awin autorisé",
            "Actualiser les historiques PrixTracker",
            "Construire les comparaisons multi-marchands par GTIN",
            "Rotation contrôlée de la vitrine cadeaux",
            "Refresh verified homepage product images",
            "Build authorized price feed",
        ):
            self.assertIn(f'      - "{name}"', workflow)
        self.assertIn("    types:\n      - completed\n    branches:\n      - main", workflow)

    def test_post_deploy_smoke_check_accepts_workflow_run_main_branch(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.workflow_run.head_branch == 'main'", workflow)
        smoke = workflow.split("  smoke-test:", 1)[1]
        self.assertIn("timeout-minutes: 10", smoke)

    def test_rakuten_price_freshness_never_uses_snapshot_timestamp(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("const rakutenSnapshotRecent", workflow)
        self.assertIn("Date.parse(p.sourceCreatedAt || \"\")", workflow)
        block = workflow.split("const rakutenPricesFresh", 1)[1].split("}).length;", 1)[0]
        self.assertIn("priceUpdatedAt", block)
        self.assertNotIn("sourceCreatedAt", block)
        self.assertNotIn("merchantUpdatedAt", block)
        self.assertIn("snapshots catalogue <48 h", workflow)
        self.assertIn("prix datés <48 h", workflow)


if __name__ == "__main__":
    unittest.main()
