// 백과사전 본문: 빈 줄로 문단을 나누고, '- '로 시작하는 줄은 목록으로 보여준다.
export function GuideBody({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-2">
      {body.split(/\n\s*\n/).map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.join(" ")}</p>;
      })}
    </div>
  );
}
