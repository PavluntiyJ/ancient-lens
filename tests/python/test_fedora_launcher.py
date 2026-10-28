import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import stratz_credentials as credentials
import stratz_service
spec = importlib.util.spec_from_file_location('launcher', SCRIPTS / 'launch-fedora.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class CredentialsTests(unittest.TestCase):
    def setUp(self):
        self.platform = patch.object(credentials, '_windows', return_value=False)
        self.platform.start()
        self.addCleanup(self.platform.stop)

    def test_secret_uses_stdin_and_roundtrips(self):
        with patch.object(credentials.subprocess, 'run', side_effect=[
            Mock(returncode=0), Mock(returncode=0, stdout='private-token', stderr='')
        ]) as run:
            credentials.save_token('private-token')
            self.assertEqual(run.call_args_list[0].kwargs['input'], 'private-token')
            self.assertNotIn('private-token', str(run.call_args_list[0].args))

    def test_failed_storage_never_falls_back_to_plaintext(self):
        with patch.object(credentials.subprocess, 'run', return_value=Mock(returncode=1)):
            with self.assertRaises(RuntimeError):
                credentials.save_token('private-token')

    def test_missing_and_locked_are_different(self):
        with patch.object(credentials.subprocess, 'run', return_value=Mock(returncode=1, stderr='')):
            self.assertIsNone(credentials.load_token())
        with patch.object(credentials.subprocess, 'run', return_value=Mock(returncode=1, stderr='locked')):
            with self.assertRaises(RuntimeError):
                credentials.load_token()

    def test_timeout_does_not_include_secret_in_error(self):
        with patch.object(credentials.subprocess, 'run', side_effect=subprocess.TimeoutExpired('secret-tool', 60)):
            with self.assertRaises(RuntimeError) as raised:
                credentials.save_token('private-token')
            self.assertNotIn('private-token', str(raised.exception))


class WindowsCredentialTests(unittest.TestCase):
    def setUp(self):
        self.platform = patch.object(credentials, '_windows', return_value=True)
        self.platform.start()
        self.addCleanup(self.platform.stop)
        self.store = {}

    def test_roundtrip_uses_credential_manager_without_a_command(self):
        def write(target, token):
            self.store[target] = token

        with patch.object(credentials, '_cred_write', side_effect=write) as wrote, patch.object(
            credentials, '_cred_read', side_effect=lambda target: self.store.get(target)
        ), patch.object(credentials.subprocess, 'run') as run:
            credentials.save_token('private-token')
            self.assertEqual(wrote.call_args.args, (credentials.WINDOWS_TARGET, 'private-token'))
            run.assert_not_called()
            self.assertEqual(credentials.load_token(), 'private-token')

    def test_missing_token_returns_none(self):
        with patch.object(credentials, '_cred_read', return_value=None):
            self.assertIsNone(credentials.load_token())

    def test_locked_store_raises_without_repeating_the_token(self):
        with patch.object(
            credentials, '_cred_read', side_effect=RuntimeError('Windows Credential Manager is unavailable or locked.')
        ):
            with self.assertRaises(RuntimeError) as raised:
                credentials.load_token()
        self.assertNotIn('private-token', str(raised.exception))

    def test_invalid_saved_token_is_rejected(self):
        with patch.object(credentials, '_cred_read', return_value='bad\ntoken'):
            with self.assertRaises(RuntimeError):
                credentials.load_token()

    def test_delete_uses_the_same_target(self):
        with patch.object(credentials, '_cred_delete') as deleted:
            credentials.delete_token()
        deleted.assert_called_once_with(credentials.WINDOWS_TARGET)

    def test_target_name_is_the_app_contract(self):
        self.assertEqual(credentials.WINDOWS_TARGET, 'Ancient Lens/STRATZ')


class ServiceRunnerTests(unittest.TestCase):
    def setUp(self):
        self.platform = patch.object(stratz_service.sys, 'platform', 'win32')
        self.platform.start()
        self.addCleanup(self.platform.stop)

    def test_waits_for_the_service_and_returns_its_code(self):
        child = Mock()
        child.wait.return_value = 7
        popen = Mock(return_value=child)
        code = stratz_service.run_windows('stats-service.exe', {'STRATZ_API_TOKEN': 'secret'}, popen=popen)
        self.assertEqual(code, 7)
        self.assertEqual(popen.call_args.args[0], ['stats-service.exe'])
        self.assertIn('STRATZ_API_TOKEN', popen.call_args.kwargs['env'])
        self.assertNotIn('secret', str(popen.call_args.args))

    def test_ctrl_c_is_forwarded_to_the_child_process_group(self):
        child = Mock()
        child.wait.side_effect = [KeyboardInterrupt, 0]
        popen = Mock(return_value=child)
        with patch.object(stratz_service.signal, 'CTRL_BREAK_EVENT', 2, create=True):
            self.assertEqual(stratz_service.run_windows('stats-service.exe', {}, popen=popen), 0)
        child.send_signal.assert_called_once_with(2)

    def test_a_stuck_service_is_terminated_after_ctrl_c(self):
        child = Mock()
        child.wait.side_effect = [KeyboardInterrupt, subprocess.TimeoutExpired('child', 8), 0]
        popen = Mock(return_value=child)
        with patch.object(stratz_service.signal, 'CTRL_BREAK_EVENT', 2, create=True):
            self.assertEqual(stratz_service.run_windows('stats-service.exe', {}, popen=popen), 0)
        child.terminate.assert_called_once()


class LauncherTests(unittest.TestCase):
    def test_existing_service_is_reused_without_prompt(self):
        with patch.object(launcher, 'ready', return_value=True), patch.object(launcher, 'load_token') as load, patch.object(launcher.subprocess, 'run') as run:
            launcher.start_service()
            load.assert_not_called()
            run.assert_not_called()

    def test_saved_token_starts_service_without_prompt(self):
        with patch.object(launcher, 'ready', side_effect=[False, True]), patch.object(launcher, 'load_token', return_value='secret'), patch.object(launcher, 'configure') as configure, patch.object(launcher.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            launcher.start_service()
            configure.assert_not_called()
            self.assertIn(['systemctl', '--user', 'start', launcher.UNIT], [c.args[0] for c in run.call_args_list])
            self.assertNotIn('secret', str(run.call_args_list))

    def test_missing_token_configures_once(self):
        with patch.object(launcher, 'ready', side_effect=[False, True]), patch.object(launcher, 'load_token', return_value=None), patch.object(launcher, 'configure') as configure, patch.object(launcher.subprocess, 'run', return_value=Mock(returncode=0)):
            launcher.start_service()
            configure.assert_called_once()

    def test_failed_service_is_reported(self):
        with patch.object(launcher, 'ready', return_value=False), patch.object(launcher, 'load_token', return_value='secret'), patch.object(launcher.subprocess, 'run', return_value=Mock(returncode=1)):
            with self.assertRaises(RuntimeError):
                launcher.start_service()


if __name__ == '__main__':
    unittest.main()
