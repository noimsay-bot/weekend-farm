"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field, Screen } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return setError("코드를 보내지 못했어요. 잠시 후 다시 시도하세요.");
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      setBusy(false);
      return setError("코드가 맞지 않거나 만료됐어요.");
    }
    // 서버 컴포넌트가 새 세션 쿠키를 읽도록 전체 이동
    window.location.replace(next);
  }

  return (
    <Screen title="주말텃밭 로그인">
      {step === "email" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <Field
            label="이메일"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
          />
          <ErrorText>{error}</ErrorText>
          <Button disabled={busy}>{busy ? "보내는 중…" : "6자리 코드 받기"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">{email}로 보낸 6자리 코드를 입력하세요.</p>
          <Field
            label="인증 코드"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <ErrorText>{error}</ErrorText>
          <Button disabled={busy || code.length !== 6}>{busy ? "확인 중…" : "로그인"}</Button>
          <Button type="button" variant="secondary" onClick={() => setStep("email")}>
            이메일 다시 입력
          </Button>
        </form>
      )}
    </Screen>
  );
}
