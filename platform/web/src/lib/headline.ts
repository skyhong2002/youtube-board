export interface TitlePiece {
    text: string;
    shared: boolean;
}
/** Character-level wording comparison only. It does not infer common events or meaning. */
export function compareTitles(
    left: string,
    right: string,
): { left: TitlePiece[]; right: TitlePiece[] } | null {
    const a = Array.from(left),
        b = Array.from(right);
    if (a.length > 500 || b.length > 500) return null;
    const scores = Array.from(
        { length: a.length + 1 },
        () => new Uint16Array(b.length + 1),
    );
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            scores[i][j] =
                a[i] === b[j]
                    ? scores[i + 1][j + 1] + 1
                    : Math.max(scores[i + 1][j], scores[i][j + 1]);
    const sameA = new Set<number>(),
        sameB = new Set<number>();
    let i = 0,
        j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            sameA.add(i++);
            sameB.add(j++);
        } else if (scores[i + 1][j] >= scores[i][j + 1]) i++;
        else j++;
    }
    const merge = (letters: string[], same: Set<number>) =>
        letters.reduce<TitlePiece[]>((pieces, char, index) => {
            const shared = same.has(index),
                previous = pieces.at(-1);
            if (previous?.shared === shared) previous.text += char;
            else pieces.push({ text: char, shared });
            return pieces;
        }, []);
    return { left: merge(a, sameA), right: merge(b, sameB) };
}
