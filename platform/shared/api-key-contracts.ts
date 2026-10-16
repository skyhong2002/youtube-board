/** Personal keys raise public read quota only; they are not login/admin credentials. */
export const PERSONAL_API_KEY_HEADER = 'x-api-key';
export const PERSONAL_API_KEYS_MAX = 3;
/** Includes revoked keys: issuance history is retained, never pruned for quota. */
export const PERSONAL_API_KEYS_LIFETIME_MAX = 100;
export const PERSONAL_API_KEY_LABEL_MAX = 64;
export interface PersonalApiKey {
  /** Decimal BIGINT string: never round a database identifier through Number. */
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface PersonalApiKeys { keys: PersonalApiKey[] }
export interface IssuedPersonalApiKey { key: PersonalApiKey; token: string }
export interface RevokedPersonalApiKey { revoked: true }
