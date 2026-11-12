export default function Wordmark({ className }: { className?: string }) {
  return <>
    <img src="/brand/wordmark-light.svg" className={`${className ?? ''} dark:hidden`} width="628" height="120" alt="有影儀表板" />
    <img src="/brand/wordmark-dark.svg" className={`${className ?? ''} hidden dark:block`} width="628" height="120" alt="有影儀表板" />
  </>;
}
