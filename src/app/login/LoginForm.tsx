"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field, Screen } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const auth = createClient().auth;

    if (mode === "signup") {
      const { data, error } = await auth.signUp({ email, password });
      if (error) {
        setBusy(false);
        return setError(
          error.code === "user_already_exists"
            ? "이미 가입된 이메일이에요. 로그인하세요."
            : error.code === "weak_password"
              ? "비밀번호가 너무 약해요. 6자 이상으로 입력하세요."
              : "가입하지 못했어요. 잠시 후 다시 시도하세요.",
        );
      }
      // 세션이 없으면(이미 가입된 이메일 등) 바로 로그인을 시도한다.
      if (!data.session) {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) {
          setBusy(false);
          return setError(
            error.code === "email_not_confirmed"
              ? "Supabase > Sign In / Providers에서 Confirm email을 끄면 바로 가입돼요."
              : "이미 가입된 이메일이에요. 로그인하세요.",
          );
        }
      }
    } else {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        setBusy(false);
        return setError("이메일 또는 비밀번호가 맞지 않아요.");
      }
    }
    // 서버 컴포넌트가 새 세션 쿠키를 읽도록 전체 이동
    window.location.replace(next);
  }

  return (
    <Screen title={mode === "signin" ? "주말텃밭 로그인" : "주말텃밭 회원가입"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="이메일"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
        />
        <Field
          label="비밀번호"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button disabled={busy}>
          {busy ? "처리 중…" : mode === "signin" ? "로그인" : "가입하기"}
        </Button>
      </form>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError("");
        }}
      >
        {mode === "signin" ? "처음이에요 (회원가입)" : "이미 계정이 있어요 (로그인)"}
      </Button>
    </Screen>
  );
}
