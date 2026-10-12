/** Public identifier only. The frontend must be built with this same setting.
 * An absent setting keeps third-party CSP transport destinations closed. */
export function analyticsTransportEnabled(env:Record<string,string|undefined>):boolean {
  return env.NODE_ENV==='production' && env.APP_ENV==='production' &&
    env.AUTH_PUBLIC_ORIGIN==='https://youtube.observe.tw' &&
    env.NEXT_PUBLIC_GA_ID==='G-X2G1PLNP7K';
}
