/** Comment collection is not running in production yet (issue #2), so every comment
 * page 404s and comment blocks stay hidden instead of showing empty states.
 * Flip this when issue #2 ships. */
export const COMMENTS_PUBLISHED = false;

/** Decoded report segments of a page that only lists collected comments. */
export function isCommentPage(segments: string[]): boolean {
    const [family, id, section] = segments;
    return family === "comments" ||
        (family === "channels" && section === "comments" && segments.length === 3) ||
        (family === "tags" && (id === "comments" ? segments.length === 2 : section === "comments" && segments.length === 3));
}
