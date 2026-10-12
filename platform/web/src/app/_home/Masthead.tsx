import styles from './home.module.css';
export default function Masthead({date,updated}:{date:string;updated:string}){
 return <div className={styles.masthead}><h1 id="home-masthead"><span className="sr-only">有影儀表板</span><img src="/brand/family/logo-light.svg" className={`${styles.mastheadMark} dark:hidden`} alt="" aria-hidden="true"/><img src="/brand/family/logo-dark.svg" className={`${styles.mastheadMark} hidden dark:block`} alt="" aria-hidden="true"/></h1><p className={styles.mastheadTagline}>同一件事，各台怎麼說</p><p className={styles.edition}>{date} · {updated}</p></div>;
}
