import type {Search} from './api';
export function queryString(search: Search, allow?: string[]) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (allow && !allow.includes(key)) continue;
        if (Array.isArray(value))
            value.forEach((item) => query.append(key, item));
        else if (value !== undefined) query.set(key, value);
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : "";
}
