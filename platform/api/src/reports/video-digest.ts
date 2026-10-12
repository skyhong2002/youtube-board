import { sql } from 'drizzle-orm';
/** Compact JSON array, matching JSON.stringify([title, description]) in the worker. */
export function videoTextDigest() {
    return sql `SHA2(CONCAT('[',JSON_QUOTE(COALESCE(v.title,'')),',',JSON_QUOTE(COALESCE(v.description,'')),']'),256)`;
}
