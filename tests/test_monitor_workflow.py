from pathlib import Path
import unittest


class ProductionMonitorWorkflowTests(unittest.TestCase):
    def test_monitor_runs_after_data_workflows_and_pages_complete_on_main(self):
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

    def test_monitor_runs_after_successful_github_pages_deployment(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("  deployment_status:\n    types: [success]", workflow)
        self.assertIn("github.event.deployment_status.state == 'success'", workflow)
        self.assertIn("github.event.deployment.environment == 'github-pages'", workflow)
        self.assertIn("github.event_name == 'deployment_status'", workflow)

    def test_post_deploy_guard_runs_only_after_successful_pages_deployment(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.workflow_run.name == 'pages build and deployment'", workflow)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", workflow)
        self.assertIn("github.event.deployment_status.state == 'success'", workflow)
        self.assertNotIn("github.ref == 'refs/heads/main' ||", workflow)

    def test_public_homepage_hides_unverified_awin_feed_prices(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn('! grep -Fq "giftListedPrice" /tmp/home-after.html', workflow)
        self.assertIn('! grep -Fq "listed_price_eur" /tmp/home-after.html', workflow)
        self.assertIn('! grep -Fq "Prix indiqué par le marchand" /tmp/home-after.html', workflow)
        self.assertIn('grep -Fq "Prix non vérifié" /tmp/home-after.html', workflow)

    def test_public_homepage_checks_current_awin_and_rakuten_price_guards(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("const liveAwin=awinFresh?", workflow)
        self.assertIn('(p.priceTaxStatus==="included"||p.price_tax_status==="included")', workflow)
        self.assertIn("const liveRakuten=rakutenFresh&&rakutenTaxVerified?", workflow)
        self.assertIn("p.comparison_authorized===true", workflow)
        self.assertNotIn("const deals=feed.products.filter", workflow)

    def test_public_rakuten_snapshot_requires_explicit_authorization(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("p.comparison_authorized !== true", workflow)
        self.assertIn("produits sans autorisation explicite", workflow)

    def test_smoke_test_does_not_run_on_push_before_pages_deployment(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        smoke = workflow.split("  smoke-test:\n", 1)[1].split("\n    name:", 1)[0]
        self.assertIn("github.event_name == 'workflow_dispatch'", smoke)
        self.assertIn("github.event_name == 'schedule'", smoke)
        self.assertIn("github.event_name == 'pull_request'", smoke)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", smoke)
        self.assertNotIn("github.event_name != 'deployment_status'", smoke)

    def test_post_deploy_guard_waits_for_pages_propagation(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("for attempt in $(seq 1 30); do", workflow)
        self.assertIn("sleep 10", workflow)

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
