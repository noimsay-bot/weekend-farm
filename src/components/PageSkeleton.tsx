// 화면 전환 중 바로 보여주는 뼈대. 서버 응답을 기다리는 동안 빈 화면 대신 나온다.
export function PageSkeleton({ title, variant = "list" }: { title?: string; variant?: "list" | "field" | "detail" }) {
  const bar = "animate-pulse rounded-xl bg-line/60";
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6" aria-busy="true" aria-label="불러오는 중">
      {title ? <h1 className="text-xl font-bold">{title}</h1> : <div className={`${bar} h-7 w-32`} />}
      {variant === "field" && (
        <>
          <div className={`${bar} aspect-[4/3] w-full rounded-2xl`} />
          <div className={`${bar} h-16`} />
          <div className={`${bar} h-16`} />
        </>
      )}
      {variant === "detail" && (
        <>
          <div className={`${bar} h-24`} />
          <div className={`${bar} h-40`} />
          <div className={`${bar} h-32`} />
        </>
      )}
      {variant === "list" &&
        Array.from({ length: 5 }, (_, i) => <div key={i} className={`${bar} h-14`} />)}
    </main>
  );
}
