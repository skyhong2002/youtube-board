/** AI person/media descriptions name their sources by raw YouTube id (「影片 tx680gAY-ww 呈現…」,
 * 「…人潮（aN5Bf6t8wvY、nM1PFPPT8WM）」). Readers get the channel name linked to the video instead. */
export type DescriptionPart={text:string}|{videoId:string;label:string};

const ID="[A-Za-z0-9_-]{11}";
const SEP="\\s*[、,，及和與]\\s*";
/** A parenthesised id list, an id after 影片/videoId, or a bare id; ids never touch other id characters. */
const PATTERN=new RegExp(
    `[（(]\\s*(?:videoId\\s*[:：]\\s*)?((?<![A-Za-z0-9_-])${ID}(?![A-Za-z0-9_-])(?:${SEP}${ID}(?![A-Za-z0-9_-]))*)\\s*[）)]`+
    `|(?:影片|videoId\\s*[:：])\\s*(?<![A-Za-z0-9_-])(${ID})(?![A-Za-z0-9_-])`+
    `|(?<![A-Za-z0-9_-])(${ID})(?![A-Za-z0-9_-])`,"g");
/** Words like "Information" are 11 letters too: an id needs a digit, _ or -, or a capital after a small letter. */
export const looksLikeVideoId=(s:string)=>/^[A-Za-z0-9_-]{11}$/.test(s)&&(/[0-9_-]/.test(s)||/[a-z][A-Z]/.test(s));

/** `channelOf` names a cited video's channel (the media card's own name, or the person's citations). */
export function descriptionParts(text:string,channelOf:(videoId:string)=>string|undefined):DescriptionPart[]{
    const order:string[]=[],seen=(id:string)=>{if(!order.includes(id))order.push(id);};
    // Number ids by first appearance only when the text names more than one video.
    for(const m of text.matchAll(PATTERN)){const ids=m[1]?m[1].split(new RegExp(SEP)):[m[2]??m[3]!];ids.filter(looksLikeVideoId).forEach(seen);}
    const n=(id:string)=>order.length>1?String(order.indexOf(id)+1):"";
    const inline=(id:string)=>{const ch=channelOf(id);return ch?`${ch} 影片${n(id)}`:`影片${n(id)}`;};
    const parts:DescriptionPart[]=[];let at=0;
    const push=(p:DescriptionPart)=>{const last=parts.at(-1);if("text" in p&&last&&"text" in last)last.text+=p.text;else if(!("text" in p)||p.text)parts.push(p);};
    for(const m of text.matchAll(PATTERN)){
        if(m[1]){
            const ids=m[1].split(new RegExp(SEP));
            if(!ids.every(looksLikeVideoId))continue;
            push({text:text.slice(at,m.index)});
            push({text:"（"});ids.forEach((id,i)=>{if(i)push({text:"、"});push({videoId:id,label:`影片${n(id)}`});});push({text:"）"});
        }else{
            const id=(m[2]??m[3])!;
            if(!looksLikeVideoId(id))continue;
            push({text:text.slice(at,m.index)});
            push({videoId:id,label:inline(id)});
        }
        at=m.index+m[0].length;
    }
    push({text:text.slice(at)});
    return parts;
}
