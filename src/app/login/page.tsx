import { LoginForm } from "./LoginForm";

// 오픈 리다이렉트 방지: 같은 사이트 내부 경로만 허용
function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}
