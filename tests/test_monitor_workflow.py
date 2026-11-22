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


if __name__ == "__main__":
    unittest.main()
