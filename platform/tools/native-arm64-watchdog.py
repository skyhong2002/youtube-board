"""One supervised compiler tick; no default live IO, launcher or CLI.

Actual transport/heartbeat and terminal cleanup remain execution-adapter work.
Ports are explicit, authenticated runtime dependencies, not configuration flags.
No tick releases custody, starts a job, packages an image or resumes paused work.
"""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location('watchdog_health_gate', Path(__file__).with_name('native-arm64-sm-gate.py'))
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def memory_valid(memory, now):
    if not isinstance(memory, dict) or set(memory) != set(gate.HOSTS):
        return False
    try:
        for row in memory.values():
            if not isinstance(row, dict) or set(row) != {'observedAt', 'availableBytes'}:
                return False
            age = (now - gate.utc_timestamp(row['observedAt'])).total_seconds()
            if not 0 <= age <= 30 or type(row['availableBytes']) is not int or row['availableBytes'] < 768 * 1024 ** 2:
                return False
    except (ValueError, TypeError, OverflowError):
        return False
    return True


class Watchdog:
    def __init__(self, executor, observe_health, observe_memory, authenticate_slot, now):
        self.executor = executor
        self.observe_health = observe_health
        self.observe_memory = observe_memory
        self.authenticate_slot = authenticate_slot
        self.now = now

    def stop(self, reason):
        try:
            result = self.executor.pause()
            confirmed = result.get('state') == 'stop-confirmed' and result.get('remoteStopConfirmed') is True
        except Exception:
            confirmed = False
        return {'state': 'stop-confirmed' if confirmed else 'STOP-unconfirmed-reservation-retained', 'reason': reason,
                'remoteStopConfirmed': confirmed,
                'reservationReleaseAllowed': False, 'runtimeReady': False}

    def tick(self):
        try:
            state, members, frozen = self.executor.read()
            if not state['running']:
                return {'state': 'terminal-proof-required', 'reservationReleaseAllowed': False,
                        'runtimeReady': False}
            if state['paused'] or frozen:
                return self.stop('paused-work-requires-explicit-resume')
            if self.authenticate_slot(self.executor.identity) is not True:
                return self.stop('current-global-slot-not-authenticated')
            samples = self.observe_health()
            memory = self.observe_memory()
            if not memory_valid(memory, self.now()):
                return self.stop('runtime-memory-low-stale-or-invalid')
            # Re-check custody after awaited observations. Never report healthy
            # if authorization was withdrawn or any raw health sample expired.
            state, members_after, frozen = self.executor.read()
            if not state['running'] or state['paused'] or frozen:
                return self.stop('compiler-state-changed-during-observation')
            if self.authenticate_slot(self.executor.identity) is not True:
                return self.stop('custody-changed-during-observation')
            # Readback/authorization may wait: revalidate both memory and raw
            # health against one decision timestamp after the final IO boundary.
            decision_now = self.now()
            if not memory_valid(memory, decision_now):
                return self.stop('runtime-memory-expired-during-readback')
            # Normal worker forks need not pause the whole compiler. Only PIDs
            # in the latest verified cgroup can be excluded from raw build counts.
            health = gate.evaluate(samples, decision_now, starting=False,
                                   owned_build_pids=frozenset(members_after))
            if not health['ok']:
                return self.stop('runtime-health-gate-failed')
            return {'state': 'running-observed', 'health': health,
                    'reservationReleaseAllowed': False, 'runtimeReady': False}
        except Exception:
            return self.stop('runtime-observation-unknown')
