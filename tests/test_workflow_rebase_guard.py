"""Les workflows qui publient des données ne doivent plus échouer sur « cannot rebase: You have unstaged changes ».

Cause racine (runs 45637871053 et 45619172643 du 25/11/2026) : les générateurs réécrivent des pages
qui ne sont pas dans la liste `git add`, puis `git rebase` refuse de démarrer. Le garde-fou met ces
fichiers de côté (git stash) avant la boucle de publication et les signale en avertissement.
"""
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
MARKER = "fichiers-generes-hors-commit"


def guard_snippet(path):
    text = path.read_text(encoding="utf-8")
    match = re.search(r"\n(\s*if \[ -n \"\$\(git status --porcelain\)\" \]; then\n.*?\n\s*fi)\n\s*for attempt in 1 2 3; do", text, re.S)
    return match.group(1) if match else None


class WorkflowRebaseGuardTest(unittest.TestCase):
    def test_every_publishing_loop_is_guarded(self):
        checked = 0
        for path in sorted(WORKFLOWS.glob("*.yml")):
            text = path.read_text(encoding="utf-8")
            loops = len(re.findall(r"for attempt in 1 2 3; do\n(?:.*\n){0,3}?.*git rebase", text))
            if not loops:
                continue
            checked += 1
            self.assertEqual(text.count(MARKER), loops, f"{path.name} : chaque boucle de rebase doit être précédée du garde-fou")
        self.assertGreaterEqual(checked, 6)

    def test_guard_lets_rebase_run_with_leftover_generated_files(self):
        snippet = guard_snippet(WORKFLOWS / "sync-awin-products.yml")
        self.assertIsNotNone(snippet)
        with tempfile.TemporaryDirectory() as tmp:
            def sh(cmd, cwd):
                return subprocess.run(["bash", "-e", "-c", cmd], cwd=cwd, capture_output=True, text=True)

            origin, work = Path(tmp, "origin.git"), Path(tmp, "work")
            env = "git -c user.name=t -c user.email=t@t "
            sh(f"git init -q --bare -b main {origin}", tmp)
            sh(f"git clone -q {origin} {work}", tmp)
            sh(f"echo a > data.json && echo p > page.html && git add . && {env}commit -qm init && git push -q origin main", work)
            # Un autre workflow publie pendant la synchronisation.
            sh(f"git clone -q {origin} other && cd other && echo x > other.txt && git add . && {env}commit -qm other && git push -q origin main", tmp)
            # Le générateur modifie une donnée suivie ET une page hors liste de staging, plus un nouveau fichier.
            sh("echo b > data.json && echo p2 > page.html && echo n > nouveau.html", work)
            sh(f"git add data.json && {env}commit -qm data", work)

            without_guard = sh("git fetch -q origin main && git rebase origin/main", work)
            self.assertNotEqual(without_guard.returncode, 0)
            self.assertIn("unstaged changes", without_guard.stderr)

            with_guard = sh(f"{snippet}\ngit fetch -q origin main && {env}rebase origin/main && git push -q origin HEAD:main", work)
            self.assertEqual(with_guard.returncode, 0, with_guard.stderr)
            self.assertIn("hors commit", with_guard.stdout)
            log = sh("git log --format=%s origin/main", work).stdout.split()
            self.assertEqual(log[:2], ["data", "other"])


if __name__ == "__main__":
    unittest.main()
