// The page-side pointer to 本頁的資料來源與計算方式 (#method sits inside its
// <details>, which browsers open for a fragment target), as tag.observe.tw MethodLink.
export default function MethodLink({
  children = '本頁的資料來源與計算方式',
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <a href="#method" className={`whitespace-nowrap text-brand-700 hover:underline dark:text-brand-400 ${className}`}>
      {children} ⓘ
    </a>
  );
}
