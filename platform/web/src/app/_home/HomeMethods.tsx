'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import styles from './home.module.css';
export default function HomeMethods({children}:{children:ReactNode}){
 const details=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const open=()=>{if(location.hash==='#home-method'&&details.current)details.current.open=true;};const click=(event:MouseEvent)=>{if(event.target instanceof Element&&event.target.closest('a[href="#home-method"]')&&details.current)details.current.open=true;};open();addEventListener('hashchange',open);document.addEventListener('click',click);return()=>{removeEventListener('hashchange',open);document.removeEventListener('click',click);};},[]);
 return <details ref={details} className={styles.method} id="home-method"><summary>資料來源與計算方式</summary>{children}</details>;
}
