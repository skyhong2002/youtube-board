import HomePage from './_home/HomePage';
// The proxy routes every `/` request to the ISR entry /render-isr/home/current; this
// dynamic copy only answers if that rewrite is ever bypassed, and is never cached.
export const dynamic='force-dynamic';
export default function Home(){return <HomePage/>;}
