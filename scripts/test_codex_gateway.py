import importlib.util
import json
import os
from pathlib import Path
import unittest
import threading
import urllib.request
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).with_name("codex_gateway.py"))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewayTests(unittest.TestCase):
    def test_http_auth_and_failure_redaction(self):
        with patch.dict(os.environ, {"CODEX_GATEWAY_KEY": "test-private-key"}):
            server = gateway.ThreadingHTTPServer(('127.0.0.1', 0), gateway.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = 'http://127.0.0.1:%s/v1/chat/completions' % server.server_port
            try:
                with patch.object(gateway, 'complete') as inference:
                    with self.assertRaises(urllib.error.HTTPError) as result:
                        urllib.request.urlopen(urllib.request.Request(endpoint, data=b'{}'))
                    self.assertEqual(401, result.exception.code)
                    inference.assert_not_called()
                with patch.object(gateway, 'complete', side_effect=RuntimeError('secret prompt / key')):
                    request = urllib.request.Request(endpoint, data=b'{}', headers={
                        'Authorization': 'Bearer test-private-key'})
                    with self.assertRaises(urllib.error.HTTPError) as result:
                        urllib.request.urlopen(request)
                    self.assertEqual(502, result.exception.code)
                    self.assertNotIn('secret', result.exception.read().decode())
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_failed_turn_never_accepts_partial_output(self):
        output = '{"content":"partial"}'
        for code, events in [(1, ''), (0, '{"type":"turn.failed"}'), (0, '')]:
            with self.assertRaises(gateway.GatewayError):
                gateway.decode_result(code, events, output)

    def test_completed_turn_preserves_json_and_usage(self):
        content = '{"topics":[{"title":"測試"}]}'
        events = json.dumps({"type": "turn.completed", "usage": {"input_tokens": 12, "output_tokens": 3}})
        actual, usage = gateway.decode_result(0, events, json.dumps({"content": content}))
        self.assertEqual(content, actual)
        self.assertEqual(15, usage["total_tokens"])

    def test_unexpected_tool_execution_is_rejected(self):
        events = '\n'.join([json.dumps({"type": "item.completed", "item": {"type": "command_execution"}}),
                            '{"type":"turn.completed"}'])
        with self.assertRaises(gateway.GatewayError):
            gateway.decode_result(0, events, '{"content":"OK"}')

    def test_secrets_not_forwarded_and_tools_disabled(self):
        with patch.dict(os.environ, {"CODEX_GATEWAY_KEY": "secret", "OPENAI_API_KEY": "secret"}):
            environment = gateway.inference_environment()
            self.assertNotIn("CODEX_GATEWAY_KEY", environment)
            self.assertNotIn("OPENAI_API_KEY", environment)
        command = gateway.command(Path('/tmp/test'), 'test-model')
        for flag in ('--ignore-user-config', '--ignore-rules', '--ephemeral',
                     'features.shell_tool=false', 'features.multi_agent=false', 'features.plugins=false'):
            self.assertIn(flag, command)

    def test_hourly_limit_fails_closed(self):
        with patch.dict(os.environ, {"CODEX_GATEWAY_CALLS_PER_HOUR": "1"}):
            gateway.CALLS.clear()
            gateway.reserve_call()
            with self.assertRaises(gateway.GatewayError) as result:
                gateway.reserve_call()
            self.assertEqual(429, result.exception.status)
            gateway.CALLS.clear()

    def test_unsupported_model_and_nontext_requests_fail_before_inference(self):
        for body in ({}, {"model": "not-configured", "messages": []},
                     {"model": "gpt-6.1-sol", "messages": [{"role": "user", "content": []}]}):
            with self.assertRaises(gateway.GatewayError):
                gateway.validate(body)


if __name__ == '__main__':
    unittest.main()
