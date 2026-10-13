"""Read-only babysit authority adapter. Never writes or invents a grant.

The queue is source identity context, not authorization. A pre-existing babysit
handoff record and its independently reviewed byte pin are both mandatory.
Missing, revoked, changed or mismatched records fail closed. Import is inert.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat

QUEUE=Path('/tmp/babysit/mint-queue/youtube.md')
HANDOFF=Path('/tmp/babysit/mint-queue/youtube-slot-handoff.json')
APP='70529cff13b6b7f5b3e0571a229e2b61660f9df4'

def require(value,code):
    if not value:raise ValueError(code)

def read_fixed(path,limit):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and 0<before.st_size<=limit,'BOUNDED_REGULAR_AUTHORITY_RECORD_REQUIRED')
        data=os.read(fd,limit+1);after=os.fstat(fd)
        require(len(data)==before.st_size and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'AUTHORITY_RECORD_CHANGED_DURING_READ')
        return data
    finally:os.close(fd)

def unique(pairs):
    result={}
    for key,value in pairs:
        require(key not in result,'DUPLICATE_AUTHORITY_FIELD');result[key]=value
    return result

def utc(value):
    require(isinstance(value,str) and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)',value),'UTC_AUTHORITY_TIME_REQUIRED')
    return dt.datetime.fromisoformat(value.replace('Z','+00:00'))

def observe_user_slot(config):
    raw=read_fixed(HANDOFF,65536)
    pin=config.get('authorityRecordSha256')
    require(isinstance(pin,str) and re.fullmatch(r'[0-9a-f]{64}',pin) and hashlib.sha256(raw).hexdigest()==pin,'REVIEWED_BABYSIT_RECORD_PIN_REQUIRED')
    record=json.loads(raw,object_pairs_hook=unique)
    keys={'schema','origin','status','currentOwner','previousOwner','appSha','opsSha','owner','generation','scope','grantAt','grantMessageId','grantMessage','grantMessageSha256','coordinationMode'}
    require(isinstance(record,dict) and set(record)==keys,'EXACT_BABYSIT_RECORD_FIELDS_REQUIRED')
    require(record['schema']=='yt-babysit-slot-handoff-v1' and record['origin']=='babysit-user-message' and record['status']=='granted' and record['currentOwner']=='YT' and record['previousOwner']=='tag','BABYSIT_CURRENT_YT_HANDOFF_REQUIRED')
    c=config['fixture']
    require(record['appSha']==APP and record['appSha']==c['appSha'] and isinstance(record['opsSha'],str) and re.fullmatch(r'[0-9a-f]{40}',record['opsSha']),'EXACT_HANDOFF_SOURCE_REQUIRED')
    for field in ('opsSha','owner','generation'):
        require(record[field]==c[field],'HANDOFF_CONFIG_BINDING_MISMATCH')
    queue=read_fixed(QUEUE,1048576).decode('utf-8')
    pins=re.findall(r'OPS_SHA\s*=\s*`([0-9a-f]{40})`',queue)
    require(pins and pins[-1]==record['opsSha'],'LATEST_QUEUE_OPS_PIN_REQUIRED')
    require(record['scope']=='mint-youtube-synthetic-fixture' and record['coordinationMode']=='human-slot-plus-common-flock-and-durable-registry','FIXTURE_ONLY_COORDINATION_REQUIRED')
    now=dt.datetime.now(dt.timezone.utc)
    require(utc(record['grantAt'])<=now,'FUTURE_HANDOFF_DENIED')
    require(isinstance(record['grantMessageId'],str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',record['grantMessageId']),'REAL_MESSAGE_ID_REQUIRED')
    require(isinstance(record['grantMessage'],str) and 0<len(record['grantMessage'].encode())<=8192 and hashlib.sha256(record['grantMessage'].encode()).hexdigest()==record['grantMessageSha256'],'EXACT_HANDOFF_MESSAGE_REQUIRED')
    for field in ('grantAt','grantMessageId','grantMessageSha256'):
        require(record[field]==config[field],'REVIEWED_GRANT_BINDING_REQUIRED')
    # observedAt is the time of this read, never a new grantAt/authorization.
    result={key:value for key,value in record.items() if key not in ('status','schema','origin')}
    result.update(schema='yt-authoritative-user-slot-observation-v1',origin='authoritative-user-session',observedAt=now.isoformat())
    return result
