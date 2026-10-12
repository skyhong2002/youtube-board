/** Matching case equivalence only: never normalize labels, whitespace or Unicode. */
export const asciiCaseFold=(text:string)=>text.replace(/[A-Z]/g,char=>char.toLowerCase());
/** Literal UTF-8 byte pattern: ASCII letters allow their two cases; all other
 * bytes are escaped, so punctuation and non-ASCII labels retain exact identity. */
export function asciiLiteralPattern(text:string):string{
 return [...Buffer.from(text,'utf8')].map(byte=>byte>=65&&byte<=90||byte>=97&&byte<=122?'['+String.fromCharCode(byte&~32,byte|32)+']':'\\x'+byte.toString(16).padStart(2,'0')).join('');
}
