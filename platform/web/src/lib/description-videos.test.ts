import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {descriptionParts,looksLikeVideoId} from './description-videos';

const show=(parts:ReturnType<typeof descriptionParts>)=>parts.map(p=>'text' in p?p.text:`[${p.label}](${p.videoId})`).join('');

test('an id after 影片 becomes the channel name, numbered when the text names several videos',()=>{
    const text='影片 tx680gAY-ww 呈現黃偉哲反駁營養午餐「跟進」說法。影片 ICQjJMMWou8 報導蔣萬安視察婦幼專責門診時回應相關爭議。';
    assert.equal(show(descriptionParts(text,()=>'三立新聞LIVE')),
        '[三立新聞LIVE 影片1](tx680gAY-ww) 呈現黃偉哲反駁營養午餐「跟進」說法。[三立新聞LIVE 影片2](ICQjJMMWou8) 報導蔣萬安視察婦幼專責門診時回應相關爭議。');
});
test('parenthesised id lists become short numbered links; a single id has no number',()=>{
    assert.equal(show(descriptionParts('已聚集的人潮（aN5Bf6t8wvY、nM1PFPPT8WM）。另呈現現場氣氛（B57-cCHDHFI）。',()=>'自由時報')),
        '已聚集的人潮（[影片1](aN5Bf6t8wvY)、[影片2](nM1PFPPT8WM)）。另呈現現場氣氛（[影片3](B57-cCHDHFI)）。');
    assert.equal(show(descriptionParts('預估震度3級以上（videoId：nEzzp2DLoFA）。',()=>'三立')),'預估震度3級以上（[影片](nEzzp2DLoFA)）。');
});
test('a bare id after another one keeps its own number, and an unknown channel falls back to 影片',()=>{
    assert.equal(show(descriptionParts('影片 3C2jrM4ILro 與 9rGEBh27Qpw 均報導',id=>id==='3C2jrM4ILro'?'民視':undefined)),
        '[民視 影片1](3C2jrM4ILro) 與 [影片2](9rGEBh27Qpw) 均報導');
});
test('ordinary words, longer tokens and text without ids are left alone',()=>{
    assert.equal(looksLikeVideoId('Information'),false);
    assert.equal(looksLikeVideoId('aN5Bf6t8wvY'),true);
    for(const text of['依 Information 頁面說明','網址 https://example.com/abcdefghijkl12 不是影片','沈伯洋車掃後抵達終點站。','（中天、TVBS）'])
        assert.equal(show(descriptionParts(text,()=>'x')),text);
});
