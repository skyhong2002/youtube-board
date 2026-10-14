import datetime as dt
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('runtime_watch_test',Path(__file__).with_name('native-arm64-runtime-watch.py'))
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
NOW=dt.datetime(2026,10,14,tzinfo=dt.timezone.utc)

class Identity:
    def binding(self):return {'containerId':'a'*64,'owner':'d7967e77'}

class Tests(unittest.TestCase):
    def setUp(self):
        self.executor=Mock(identity=Identity())
        self.stop=Mock(return_value={'state':'stop-confirmed','reservationReleaseAllowed':False})
        self.packet={'schema':'yt-native-runtime-heartbeat-v1','binding':self.executor.identity.binding(),'sequence':0,'slotHeld':True,'observedAt':NOW.isoformat(),'samples':{},'memory':{}}
        self.watch=m.RuntimeWatch(self.executor,lambda:self.packet,lambda:NOW)
        self.watch.watchdog.stop=self.stop
        self.watch.watchdog.tick=Mock(return_value={'state':'running-observed'})

    def test_authenticated_packet_reaches_real_tick(self):
        self.assertEqual(self.watch.once()['state'],'running-observed');self.watch.watchdog.tick.assert_called_once()

    def test_replay_pauses_and_retains(self):
        self.watch.once();self.assertEqual(self.watch.once()['state'],'stop-confirmed');self.stop.assert_called_once()

    def test_withdrawn_wrong_identity_and_stale_each_pause(self):
        for changes in ({'slotHeld':False},{'binding':{}},{'observedAt':(NOW-dt.timedelta(seconds=31)).isoformat()},{'observedAt':(NOW+dt.timedelta(seconds=1)).isoformat()}):
            with self.subTest(changes=changes):
                self.setUp();self.packet.update(changes)
                self.assertEqual(self.watch.once()['state'],'stop-confirmed');self.watch.watchdog.tick.assert_not_called()

    def test_sensitive_extra_field_is_never_returned(self):
        self.packet['token']='private-test-token';self.assertNotIn('private-test-token',str(self.watch.once()))
        self.watch.watchdog.tick.assert_not_called()

    def test_transport_error_and_eof_pause(self):
        self.watch.receive=Mock(side_effect=EOFError('secret'));self.assertNotIn('secret',str(self.watch.once()));self.stop.assert_called_once()

    def test_wire_connects_real_docker_and_kernel_ports(self):
        docker=Mock();group=Mock();executor=Mock(identity=Identity())
        with patch.object(m.docker_module,'DockerBackend',return_value=docker),patch.object(m.cgroup_module,'CgroupBackend',return_value=group),patch.object(m.executor_module,'Executor',return_value=executor) as factory:
            watch=m.wire(executor.identity,'tool-pin',lambda:{},lambda:NOW)
            args=factory.call_args.args
            self.assertIs(args[1],docker.inspect);self.assertIs(args[2],docker.dispatch);self.assertIs(args[3],group.observe)
            self.assertIs(watch.executor,executor)

    def test_duplicate_fields_are_rejected(self):
        with self.assertRaises(ValueError):m.json.loads('{"sequence":1,"sequence":2}',object_pairs_hook=m.unique)

    def test_packet_cap_and_eof(self):
        class Selector:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def register(self,*a):pass
            def select(self,*a):return [True]
        for chunks in ([b''],[b'x'*(m.MAX_PACKET+1)]):
            reader=m.PacketReader(0,selector=Selector,read=Mock(side_effect=chunks))
            with self.assertRaises(ValueError):reader.receive()

    def test_backpressure_reaches_output_deadline(self):
        class Selector:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def register(self,*a):pass
            def select(self,*a):return [True]
        clock=Mock(side_effect=[0,0.1,1.1])
        write=Mock(side_effect=BlockingIOError)
        with self.assertRaises(ValueError):m.emit({'state':'running-observed'},clock=clock,selector=Selector,write=write,set_blocking=Mock())
        write.assert_called_once()

    def test_broken_output_cleanup_stops_before_any_output(self):
        order=[]
        self.watch.watchdog.stop=Mock(side_effect=lambda _:order.append('pause') or {'state':'stop-confirmed'})
        with patch.object(m,'emit',side_effect=lambda _:order.append('output') or (_ for _ in ()).throw(BrokenPipeError())):
            self.assertEqual(m.cleanup(self.watch),1)
        self.assertEqual(order,['pause','output'])

    def test_main_backpressure_pauses_without_another_input(self):
        identity=Identity();watch=Mock()
        watch.once.return_value={'state':'running-observed','reservationReleaseAllowed':False}
        watch.watchdog.stop.return_value={'state':'stop-confirmed'}
        with patch.object(m.sys,'argv',['watch','{}','{}']),patch.object(m.executor_module,'Identity',return_value=identity),patch.object(m.docker_module,'ToolPin'),patch.object(m,'wire',return_value=watch),patch.object(m.sys,'stdin'),patch.object(m.signal,'signal'),patch.object(m,'emit',side_effect=ValueError('output-timeout')):
            self.assertEqual(m.main(),1)
        watch.once.assert_called_once();watch.watchdog.stop.assert_called_once()

    def test_termination_enters_cleanup_instead_of_default_exit(self):
        for sig in (m.signal.SIGTERM,m.signal.SIGHUP,m.signal.SIGINT):
            with self.assertRaises(KeyboardInterrupt):m.interrupt_watch(sig,None)

    def test_timeout(self):
        class Selector:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def register(self,*a):pass
            def select(self,*a):return []
        reader=m.PacketReader(0,selector=Selector)
        with self.assertRaises(ValueError):reader.receive()

if __name__=='__main__':unittest.main()
