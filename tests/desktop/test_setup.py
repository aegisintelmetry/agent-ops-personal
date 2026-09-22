import base64
import copy
import io
import json
import os
import stat
import tempfile
import unittest
import zipfile
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from agent_ops.client.config import Profile
from agent_ops.desktop import bundle_install as bundle, enrollment, setup_runtime as setup


class SetupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.profile = Profile(name="desktop-test", mcp_url_configured=True, token_configured=True,
            runner="team-02.dev.runner", workspace=self.root / "workspaces/desktop-test",
            config_path=self.root / "config.toml", team_id="team-02", team_type="dev",
            central_url="https://central.invalid", central_profile_id="profile-test", mcp_url="https://mcp.invalid/mcp")
        now = datetime.now(timezone.utc)
        self.auth = {"status": "authenticated", "session_id": "A" * 43,
            "issued_at": now.isoformat(), "expires_at": (now + timedelta(minutes=2)).isoformat(),
            "binding": {"runner_id": self.profile.runner, "profile_id": "profile-test"},
            "profile": {"profile_id": "profile-test", "runner_id": self.profile.runner,
                "team_id": "team-02", "team_type": "dev", "engine": "claude", "is_active": True,
                "target_host": "test-host"},
            "mcp_runtime": {"url": "https://mcp.invalid/mcp", "token": "fixture-not-real"},
            "engine_auth": {"status": "available"}}
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {}, clear=True).start()
        patch.object(enrollment.platform, "node", return_value="test-host").start()
        patch.object(setup, "managed_root", return_value=self.root).start()

    def auth_call(self, response=None):
        with patch.object(enrollment, "post_json", return_value=response or self.auth):
            return enrollment.authenticate(self.profile, self.profile.central_url, "profile-test")

    def test_profile_identity_is_bound_to_server_and_host(self):
        bound, _ = self.auth_call()
        self.assertEqual(bound.runner, self.profile.runner)

    def test_auth_rejects_foreign_host_inactive_profile_or_wrong_id(self):
        for key, value in (("target_host", "other-host"), ("is_active", False), ("profile_id", "other")):
            data = copy.deepcopy(self.auth)
            data["profile"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.auth_call(data)

    def test_auth_rejects_wrong_session_binding_before_storage(self):
        data = copy.deepcopy(self.auth)
        data["binding"]["runner_id"] = "other"
        with self.assertRaises(Exception), patch.object(enrollment.config, "write_config") as write:
            self.auth_call(data)
        write.assert_not_called()

    def test_auth_rejects_environment_identity_conflict(self):
        with patch.dict(os.environ, {"BTK_RUNNER_ID": "other"}), self.assertRaisesRegex(ValueError, "BTK_RUNNER_ID"):
            self.auth_call()

    def test_auth_rejects_stale_environment_token_without_exposing_it(self):
        with patch.dict(os.environ, {"MCP_TOKEN": "fixture-stale-secret"}), self.assertRaises(ValueError) as error:
            self.auth_call()
        self.assertNotIn("fixture-stale-secret", str(error.exception))

    def test_registration_preserves_existing_config_and_never_returns_credentials(self):
        from agent_ops.client import config, auth_session
        home = self.root / "configuration"
        service = Mock()
        service.profile.return_value = replace(self.profile, runner="", team_id="", central_url="", central_profile_id="")
        with patch.object(config, "CONFIG_HOME", home), patch.object(config, "CONFIG_PATH", home / "config.toml"), \
             patch.object(config, "AUTH_PROFILE_DIR", home / "profiles"), \
             patch.object(auth_session, "CONFIG_HOME", home), patch.object(auth_session, "SESSION_PATH", home / "auth-session.json"), \
             patch.object(enrollment, "managed_root", return_value=self.root), \
             patch.object(enrollment, "post_json", return_value=self.auth):
            config.write_config({"profiles": {"unrelated": {"runner_id": "other-runner"}}})
            result = enrollment.enroll(service, {"central_url": "https://central.invalid", "profile_id": "profile-test", "bootstrap_token": "fixture-one-time"})
            data = config.load_config()
            self.assertEqual(data["profiles"]["unrelated"]["runner_id"], "other-runner")
            profile = config.current_profile()
            self.assertEqual(profile.runner, self.profile.runner)
            self.assertEqual(profile.central_profile_id, "profile-test")
            self.assertEqual(config.profile_token(profile), "fixture-not-real")
            self.assertNotIn("fixture-not-real", json.dumps(result))
            self.assertNotIn("fixture-one-time", json.dumps(result))

    def test_auth_requires_team_type_and_supported_engine(self):
        for key, value in (("team_type", ""), ("engine", "arbitrary")):
            data = copy.deepcopy(self.auth)
            data["profile"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.auth_call(data)

    def test_central_mcp_policy_error_is_a_replyable_validation_error(self):
        data = copy.deepcopy(self.auth)
        data["mcp_runtime"]["url"] = "http://192.0.2.10:8010/mcp"
        with self.assertRaisesRegex(ValueError, "중앙에서 받은 MCP 주소.*IPv4"):
            self.auth_call(data)

    def test_mcp_https_error_names_the_central_response_not_user_input(self):
        with self.assertRaisesRegex(ValueError, "중앙에서 받은 MCP 주소.*HTTPS"):
            enrollment.https_url("http://mcp.invalid/mcp", label="중앙에서 받은 MCP 주소")

    def test_https_only_no_embedded_credentials_or_redirect(self):
        for url in ("http://central.invalid", "https://user:pass@central.invalid", "https://central.invalid?token=x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                enrollment.https_url(url)
        with self.assertRaises(ValueError):
            enrollment.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid")

    def make_zip(self, extra=None):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("install.ps1", "fixture")
            for name in bundle.REQUIRED:
                archive.writestr("repo_overlay/" + name, "fixture")
            for name, value in extra or []:
                if isinstance(name, str):
                    item = zipfile.ZipInfo(name)
                    item.filename = name
                    archive.writestr(item, value)
                else:
                    archive.writestr(name, value)
        return out.getvalue()

    def wrapper(self, raw):
        wrapper = json.dumps({"content_base64": base64.b64encode(raw).decode(), "size_bytes": len(raw), "sha256": bundle.sha(raw)})
        return {"schema_version": "btk.cli_latest_pointer.v1", "wrapper_sha256": bundle.sha(wrapper.encode()),
                "zip_sha256": bundle.sha(raw), "zip_size_bytes": len(raw)}, wrapper

    def test_bundle_checks_pointer_wrapper_zip_and_size(self):
        raw = self.make_zip()
        pointer, wrapper = self.wrapper(raw)
        self.assertEqual(bundle.checked_zip(pointer, wrapper), raw)
        for key, value in (("wrapper_sha256", "0" * 64), ("zip_sha256", "0" * 64), ("zip_size_bytes", 1)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                bundle.checked_zip({**pointer, key: value}, wrapper)

    def test_bundle_extracts_required_components(self):
        target = bundle.extract_checked(self.make_zip(), self.root / "extracted")
        self.assertTrue((target / "repo_overlay" / bundle.REQUIRED[0]).is_file())

    def test_published_v1_pointer_without_wrapper_hash_still_checks_zip(self):
        raw = self.make_zip()
        pointer, wrapper = self.wrapper(raw)
        pointer.pop("wrapper_sha256")
        self.assertEqual(bundle.checked_zip(pointer, wrapper), raw)
        for key, value in (("zip_sha256", None), ("zip_sha256", "0" * 64), ("zip_size_bytes", True),
                           ("zip_size_bytes", 1), ("wrapper_sha256", "bad")):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                bundle.checked_zip({**pointer, key: value}, wrapper)

    def test_bundle_rejects_path_escape_ads_reserved_and_case_collision(self):
        for name in ("../escape", "/absolute", "C:/outside", "file:stream", "foo\\bar", "NUL.txt", "bad. /file", "INSTALL.PS1"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                bundle.extract_checked(self.make_zip([(name, "bad")]), self.root / "unsafe")
        self.assertFalse((self.root / "unsafe").exists())

    def test_bundle_rejects_symlinks_and_zip_bomb(self):
        link = zipfile.ZipInfo("link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            bundle.extract_checked(self.make_zip([(link, "../../outside")]), self.root / "unsafe")
        with patch.object(bundle, "MAX_EXPANDED", 2), self.assertRaises(ValueError):
            bundle.extract_checked(self.make_zip(), self.root / "unsafe")

    def test_missing_component_is_not_a_complete_bundle(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("install.ps1", "fixture")
        with self.assertRaisesRegex(ValueError, "필수 구성"):
            bundle.extract_checked(out.getvalue(), self.root / "missing")

    def test_download_uses_only_latest_authority_and_validated_artifact(self):
        pointer, wrapper = self.wrapper(self.make_zip())
        pointer.update(task_id="REL-001", artifact="runs/REL-001/upload/package.json", package="test")
        download = Mock(side_effect=[json.dumps(pointer), wrapper])
        info = bundle.download(self.profile, self.profile.mcp_url, self.root / "download", download)
        self.assertEqual(download.call_args_list[0].kwargs["artifact_path"], "runs/btk-cli-latest/upload/latest.json")
        self.assertEqual(info["zip_sha256"], pointer["zip_sha256"])

    def test_managed_path_rejects_existing_checkout(self):
        self.assertEqual(setup.require_managed(self.profile), self.profile.workspace)
        with self.assertRaises(ValueError):
            setup.require_managed(replace(self.profile, workspace=self.root / "existing-repo"))

    def test_existing_process_or_unknown_probe_blocks_install(self):
        for observation in ({"status": "unknown", "processes": []}, {"status": "observed", "processes": [{"pid": 1}]}):
            with patch.object(setup, "process_observation", return_value=observation), self.assertRaises(ValueError):
                setup.require_quiet()

    def test_setup_accepts_no_commands_paths_or_truthy_strings(self):
        manager = setup.SetupManager(Mock())
        for params in ({"command": "calc"}, {"repo": "C:/"}, {"autostart": "true"}):
            with self.assertRaises(ValueError):
                manager.start(params)

    def test_status_is_an_independent_snapshot(self):
        manager = setup.SetupManager(Mock())
        view = manager.status()
        view["status"] = "completed"
        self.assertEqual(manager.status()["status"], "idle")

    def test_startup_is_packaged_only_and_uninstall_removes_only_owned_shortcut(self):
        with patch.object(setup.sys, "frozen", False, create=True), self.assertRaises(ValueError):
            setup.register_startup(self.profile)
        with patch.dict(os.environ, {"APPDATA": str(self.root)}), patch.object(setup, "run") as run:
            setup.remove_startup()
        script = run.call_args.args[0][-1]
        self.assertIn("$link.TargetPath -eq $env:BTK_DESKTOP_CORE", script)
        self.assertIn("Remove-Item -LiteralPath", script)
        self.assertNotIn("-Recurse", script)

    def test_halt_blocks_service_launch(self):
        with patch.object(setup, "require_quiet"), patch.object(setup, "verify_runtime", return_value="runner"), \
             patch.object(setup, "active_halts_for_context", return_value=["halt"]), \
             patch.object(setup.subprocess, "Popen") as popen, self.assertRaisesRegex(ValueError, "중지 정책"):
            setup.prepare_supervisor(self.profile)
        popen.assert_not_called()

    def test_read_only_desktop_chat_has_no_installer_tool(self):
        from agent_ops.desktop.service import safe_popen
        with patch("agent_ops.desktop.service.subprocess.Popen") as popen:
            safe_popen(["claude", "--tools", ""])
        command = popen.call_args.args[0]
        self.assertIn("--safe-mode", command)
        self.assertIn('{"mcpServers":{}}', command)

    def workflow(self, fail_runtime=False, start_requested=False, health=None):
        manager = setup.SetupManager(Mock())
        manager.state = {"status": "running", "steps": [{"id": k, "label": v, "status": "pending"} for k, v in setup.STEPS]}
        with patch.object(setup, "authenticate", return_value=(self.profile, self.auth)), \
             patch.object(setup, "store_auth_response"), \
             patch.object(setup, "DeploymentReporter"), \
             patch.object(setup.bundle_install, "download", return_value={"authority": "latest", "zip_sha256": "fixture"}), \
             patch.object(setup, "install_dependencies", return_value=("python", {})), \
             patch.object(setup, "require_quiet"), patch.object(setup, "run", side_effect=RuntimeError("fixture failure") if fail_runtime else None) as run, \
             patch.object(setup, "verify_runtime"), patch.object(setup, "write_receipt"), \
             patch.object(setup, "verify_service_health", return_value=health), \
             patch.object(setup, "start_services") as start, patch.object(setup, "register_startup") as startup:
            manager._install(self.profile, {"start_services": start_requested, "autostart": False})
        return manager, run, start, startup

    def test_install_pipeline_respects_no_start_no_autostart_and_no_config_overwrite(self):
        manager, run, start, startup = self.workflow()
        self.assertEqual(manager.status()["status"], "completed")
        self.assertEqual(manager.status()["heartbeat_status"], "unknown")
        command = run.call_args_list[0].args[0]
        self.assertIn("-SkipConfig", command)
        self.assertIn("-NoPathUpdate", command)
        self.assertNotIn("-ResetVenv", command)
        start.assert_not_called()
        startup.assert_not_called()

    def test_failure_never_starts_services_or_claims_completed_and_can_retry(self):
        manager, _, start, startup = self.workflow(fail_runtime=True)
        self.assertEqual(manager.status()["status"], "failed")
        self.assertEqual(next(r for r in manager.status()["steps"] if r["id"] == "runtime")["status"], "failed")
        start.assert_not_called()
        startup.assert_not_called()
        self.assertTrue(setup.receipt_path(self.profile).with_name("attempt.json").is_file())
        (self.profile.workspace / "partial.txt").write_text("owned partial")
        retried, _, _, _ = self.workflow()
        self.assertEqual(retried.status()["status"], "completed")
        self.assertTrue((self.profile.workspace / "partial.txt").exists())

    def test_started_supervisor_with_missing_service_is_partial(self):
        manager, _, start, _ = self.workflow(start_requested=True, health={
            "status": "partial", "heartbeat_status": "idle", "heartbeat_age_minutes": 0.2,
            "error": "서비스 기동 검증 미완료: log_error_monitor.py"})
        start.assert_called_once()
        self.assertEqual(manager.status()["status"], "partial")
        self.assertEqual(manager.status()["heartbeat_age_minutes"], 0.2)
        self.assertEqual(next(r for r in manager.status()["steps"] if r["id"] == "health")["status"], "partial")

    def test_verified_services_publish_measured_heartbeat(self):
        manager, _, _, _ = self.workflow(start_requested=True, health={
            "status": "completed", "heartbeat_status": "idle", "heartbeat_age_minutes": 0.1})
        self.assertEqual(manager.status()["status"], "completed")
        self.assertEqual(manager.status()["heartbeat_age_minutes"], 0.1)


if __name__ == "__main__":
    unittest.main()
