#!/usr/bin/env python3
"""Un-blind one saved review and append its scores.

  python3 docs/design-review/tools/score.py ROUND REVIEWER RESULT_MD

Reads the last ```json block of RESULT_MD (the reviewer's raw output saved under
docs/design-review/results/), maps A/B/C back with /tmp/yb-review/private/rROUND.json
and appends one row per set to docs/design-review/results/scores.tsv:
round, reviewer, set (baseline|new|reference), overall, mean of the 12 items.
"""
import json
import re
import sys
from pathlib import Path

ITEMS = ['資訊層級', '字體排印', '色彩', '間距與版面', '一致性', '資訊密度', '導覽', '狀態與回饋', '響應式', '文案', '無障礙', '動畫與轉場']
RESULTS = Path(__file__).resolve().parents[1] / 'results'


def main():
    number, reviewer, result = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    blocks = re.findall(r'```json\s*(\{.*?\})\s*```', result.read_text(), re.S)
    if not blocks:
        sys.exit('no json block in ' + str(result))
    scores = json.loads(blocks[-1])
    mapping = json.loads(Path(f'/tmp/yb-review/private/r{number}.json').read_text())['mapping']
    table = RESULTS / 'scores.tsv'
    if not table.exists():
        table.write_text('round\treviewer\tset\toverall\tmean\n')
    out = {}
    for label, name in mapping.items():
        entry = scores[label]
        values = [float(entry['scores'][item]) for item in ITEMS]
        mean = round(sum(values) / len(values), 2)
        out[name] = (entry.get('overall'), mean)
        with table.open('a') as handle:
            handle.write(f'{number}\t{reviewer}\t{name}\t{entry.get("overall")}\t{mean}\n')
    for name in ('baseline', 'new', 'reference'):
        overall, mean = out[name]
        print(f'{name:9} overall {overall}  mean {mean}')
    print(f'new − baseline: overall {float(out["new"][0]) - float(out["baseline"][0]):+.1f}, mean {out["new"][1] - out["baseline"][1]:+.2f}')


if __name__ == '__main__':
    main()
