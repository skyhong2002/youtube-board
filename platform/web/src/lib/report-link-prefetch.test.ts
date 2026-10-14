import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {isValidElement, type ReactNode} from 'react';
import Link from 'next/link';
import {reportLinkPrefetch} from './report-contract';
import {TopicCards} from '../components/DataViews';
import SectionTabs from '../components/SectionTabs';
import {SectionHeading} from '../components/ReportUI';
import {ReportTable} from '../components/ReportTable';
import type {TopicRow} from '../../../api/src/contracts';

const eventHref='/ai/days/00123/events?event='+encodeURIComponent('交通 & %41 / 支持');
function links(node: ReactNode): Array<{href: string; prefetch?: boolean}> {
    if (Array.isArray(node)) return node.flatMap(links);
    if (!isValidElement<{children?: ReactNode; href?: string; prefetch?: boolean; value?: unknown}>(node)) return [];
    if (node.type === Link) return [{href: node.props.href!, prefetch: node.props.prefetch}];
    // Inspect the actual private table Cell; never invoke hook components.
    if (typeof node.type === 'function' && node.type.name === 'Cell' && 'value' in node.props)
        return links((node.type as (props: unknown) => ReactNode)(node.props));
    return links(node.props.children);
}
test('numeric daily-event links disable queryless prefetch including decoded aliases',()=>{
    for (const href of [eventHref,'/ai/days/123/events','/ai/days/0/events/',
        '/%61i/%64ays/%31%32%33/%65vents?event=x',
        'https://youtube.observe.tw/ai/days/123/events?event=x'])
        assert.equal(reportLinkPrefetch(href),false,href);
});
test('other routes and unsafe or external URLs retain automatic prefetch',()=>{
    for (const href of ['/ai/days/2026-10-14/events?event=x','/ai/events/123',
        '/ai/days/123/events/people?event=x','/keywords?event=x','/keywords/支持/videos',
        '/ai/days/%2531/events','/ai/days/%ZZ/events','https://elsewhere.test/ai/days/123/events',
        '//elsewhere.test/ai/days/123/events','javascript:alert(1)',
        'https://user:pass@youtube.observe.tw/ai/days/123/events','/ai/days/123/events\n'])
        assert.equal(reportLinkPrefetch(href),undefined,href);
});
test('topic links preserve event bytes and disable only numeric event prefetch',()=>{
    const topic: TopicRow={id:'topic',dailyId:123,title:'交通 & %41 / 支持',channelCount:1,
        videoCount:1,score:1,keywords:[],people:[],evidence:[],unresolvedReferences:[]};
    assert.deepEqual(links(TopicCards({rows:[topic],date:null})),
        [{href:'/ai/days/123/events?event='+encodeURIComponent(topic.title),prefetch:false}]);
    assert.deepEqual(links(TopicCards({rows:[{...topic,detailUrl:eventHref}],date:null})),[{href:eventHref,prefetch:false}]);
    const dateHref='/ai/days/2026-10-14/events';
    assert.deepEqual(links(TopicCards({rows:[{...topic,detailUrl:dateHref}],date:null})),[{href:dateHref,prefetch:undefined}]);
});
test('tabs and headings preserve event queries and default other links',()=>{
    assert.deepEqual(links(SectionTabs({label:'報表',tabs:[{href:eventHref,label:'議題'},{href:'/keywords',label:'排行'}]})),
        [{href:eventHref,prefetch:false},{href:'/keywords',prefetch:undefined}]);
    assert.deepEqual(links(SectionHeading({title:'議題',href:eventHref})),[{href:eventHref,prefetch:false}]);
});
test('generic report table cells preserve click URLs and scoped prefetch',()=>{
    const tree=ReportTable({label:'來源',columns:[{key:'title',label:'議題',kind:'text'}],
        rows:[{title:{value:'議題',href:eventHref}},{title:{value:'排行',href:'/keywords'}}]});
    assert.deepEqual(links(tree),[{href:eventHref,prefetch:false},{href:'/keywords',prefetch:undefined}]);
});
