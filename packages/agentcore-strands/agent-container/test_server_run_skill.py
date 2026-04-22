"""Tests for run_skill_dispatch — kind='run_skill' composition handler.

Covers:
  * Happy path — composition completes (mocked) → status='complete' POSTed back
  * Failure path — all sub-skills fail via SkillNotRegisteredError → status='failed'
    with a reason naming the missing skill
  * skillId not loaded → status='failed' with "not loaded" reason
  * Missing required envelope fields → returns failed without posting
  * Completion POST 5xx — logs loudly, dispatch still returns status (smoke
    timeout is the canonical backstop for dropped writeback)

Run with:
    uv run --with pytest --no-project pytest packages/agentcore-strands/agent-container/test_server_run_skill.py
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import run_skill_dispatch  # noqa: E402


class DispatchRunSkillTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)

    # ---- Happy paths ------------------------------------------------------

    async def test_composition_complete_posts_complete(self):
        mock_install = MagicMock()
        mock_load = MagicMock(return_value={"my-comp": MagicMock()})

        class Result:
            status = "complete"
            failure_reason = None

        async def fake_run_composition(comp, resolved, dispatch, context=None):
            return Result()

        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "install_skills": MagicMock(install_skill_from_s3=mock_install),
                 "skill_runner": MagicMock(load_composition_skills=mock_load),
                 "composition_runner": MagicMock(run_composition=fake_run_composition),
             }):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-1",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "my-comp",
                "resolvedInputs": {"k": "v"},
                "scope": {"tenantId": "tenant-1"},
            })

        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(posts), 1)
        post_args, _ = posts[0]
        self.assertEqual(post_args[0], "run-1")
        self.assertEqual(post_args[1], "tenant-1")
        self.assertEqual(post_args[2], "complete")
        mock_install.assert_called_once_with("skills/catalog/my-comp", "my-comp")

    async def test_failed_composition_posts_failure_reason(self):
        mock_install = MagicMock()
        mock_load = MagicMock(return_value={"my-comp": MagicMock()})

        class Result:
            status = "failed"
            failure_reason = (
                "step 'gather' failed: skill 'crm_account_summary' "
                "not registered in this runtime"
            )

        async def fake_run_composition(*a, **kw):
            return Result()

        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "install_skills": MagicMock(install_skill_from_s3=mock_install),
                 "skill_runner": MagicMock(load_composition_skills=mock_load),
                 "composition_runner": MagicMock(run_composition=fake_run_composition),
             }):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-2",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "my-comp",
                "resolvedInputs": {},
                "scope": {},
            })

        self.assertEqual(result["status"], "failed")
        self.assertIn("crm_account_summary", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")

    # ---- Edge + error paths -----------------------------------------------

    async def test_skill_not_loaded_returns_failed_without_running(self):
        mock_install = MagicMock()
        mock_load = MagicMock(return_value={})
        mock_run = MagicMock()

        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "install_skills": MagicMock(install_skill_from_s3=mock_install),
                 "skill_runner": MagicMock(load_composition_skills=mock_load),
                 "composition_runner": MagicMock(run_composition=mock_run),
             }):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-3",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "not-real",
                "resolvedInputs": {},
                "scope": {},
            })

        self.assertEqual(result["status"], "failed")
        self.assertIn("not loaded", result["failureReason"])
        mock_run.assert_not_called()
        self.assertEqual(posts[0][0][2], "failed")

    async def test_missing_run_id_returns_failed_without_posting(self):
        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "tenantId": "tenant-1",
                "skillId": "sales-prep",
            })
        self.assertEqual(result["status"], "failed")
        self.assertIn("missing", result["error"])
        self.assertEqual(posts, [])

    async def test_composition_runner_raises_caught_and_posted(self):
        mock_install = MagicMock()
        mock_load = MagicMock(return_value={"my-comp": MagicMock()})

        async def fake_run_composition(*a, **kw):
            raise RuntimeError("yaml corrupted")

        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "install_skills": MagicMock(install_skill_from_s3=mock_install),
                 "skill_runner": MagicMock(load_composition_skills=mock_load),
                 "composition_runner": MagicMock(run_composition=fake_run_composition),
             }):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-4",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "my-comp",
                "resolvedInputs": {},
                "scope": {},
            })

        self.assertEqual(result["status"], "failed")
        self.assertIn("yaml corrupted", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")

    async def test_s3_sync_failure_posted_as_failed(self):
        def boom(*a, **kw):
            raise RuntimeError("s3 access denied")

        mock_install = MagicMock(side_effect=boom)

        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "install_skills": MagicMock(install_skill_from_s3=mock_install),
             }):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-5",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "sales-prep",
                "resolvedInputs": {},
                "scope": {},
            })
        self.assertEqual(result["status"], "failed")
        self.assertIn("s3 access denied", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")


class PostCompletionTests(unittest.TestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"

    def test_missing_env_logs_and_returns(self):
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)
        # Does not raise
        run_skill_dispatch.post_skill_run_complete(
            "run-x", "tenant-x", "failed", failure_reason="x",
        )

    def test_5xx_response_logged_no_raise(self):
        import urllib.error
        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=500, msg="boom", hdrs=None, fp=None,
            )
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            # Does not raise
            run_skill_dispatch.post_skill_run_complete(
                "run-x", "tenant-x", "failed", failure_reason="x",
            )


if __name__ == "__main__":
    unittest.main()


class InvokeSubSkillTests(unittest.TestCase):
    """Covers the script-skill dispatch closure used by run_composition.

    Uses a tmp /tmp/skills-style layout so the test exercises the real
    import + call flow without hitting S3 or AWS.
    """

    def setUp(self):
        import tempfile
        self._tmp = tempfile.mkdtemp(prefix="smoke-skills-")
        # Patch SKILLS_DIR in the install_skills module stub we inject into sys.modules.
        self._install_mock = MagicMock(install_skill_from_s3=MagicMock(),
                                       SKILLS_DIR=self._tmp)

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_skill(self, slug: str, script_body: str, fn_name: str):
        import os
        skill_dir = os.path.join(self._tmp, slug)
        os.makedirs(os.path.join(skill_dir, "scripts"), exist_ok=True)
        with open(os.path.join(skill_dir, "skill.yaml"), "w") as f:
            f.write(
                "id: {slug}\n"
                "execution: script\n"
                "scripts:\n"
                "  - name: {fn}\n"
                "    path: scripts/entry.py\n".format(slug=slug, fn=fn_name)
            )
        with open(os.path.join(skill_dir, "scripts", "entry.py"), "w") as f:
            f.write(script_body)

    def test_script_skill_returns_value(self):
        self._write_skill(
            "echo-skill",
            "def run(message, **_): return {'echoed': message}\n",
            fn_name="run",
        )
        with patch.dict(sys.modules, {"install_skills": self._install_mock}):
            out = run_skill_dispatch._invoke_sub_skill(
                "echo-skill", {"message": "hi"}
            )
        self.assertEqual(out, {"echoed": "hi"})

    def test_context_skill_raises_not_registered(self):
        import os
        slug = "ctx-skill"
        skill_dir = os.path.join(self._tmp, slug)
        os.makedirs(skill_dir, exist_ok=True)
        with open(os.path.join(skill_dir, "skill.yaml"), "w") as f:
            f.write("id: ctx-skill\nexecution: context\n")
        with patch.dict(sys.modules, {"install_skills": self._install_mock}):
            with self.assertRaises(run_skill_dispatch.SkillNotRegisteredError) as cm:
                run_skill_dispatch._invoke_sub_skill("ctx-skill", {})
        self.assertIn("execution='context'", str(cm.exception))

    def test_missing_yaml_raises_not_registered(self):
        with patch.dict(sys.modules, {"install_skills": self._install_mock}):
            with self.assertRaises(run_skill_dispatch.SkillNotRegisteredError) as cm:
                run_skill_dispatch._invoke_sub_skill("no-such-skill", {})
        self.assertIn("skill.yaml", str(cm.exception))

    def test_bad_inputs_shape_raises_not_registered(self):
        self._write_skill(
            "strict-skill",
            "def run(required_field, **_): return 'ok'\n",
            fn_name="run",
        )
        with patch.dict(sys.modules, {"install_skills": self._install_mock}):
            with self.assertRaises(run_skill_dispatch.SkillNotRegisteredError) as cm:
                run_skill_dispatch._invoke_sub_skill("strict-skill", {"wrong": 1})
        self.assertIn("refused inputs", str(cm.exception))
