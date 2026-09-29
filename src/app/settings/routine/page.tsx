import Link from "next/link";
import { Screen } from "@/components/ui";

// 갤럭시 '모드 및 루틴'으로 밭에 도착하면 앱을 자동으로 여는 방법 (네이티브 앱 없이)
export default function RoutineGuidePage() {
  const steps = [
    "먼저 Chrome 메뉴 > '홈 화면에 추가'로 주말텃밭을 설치해 두세요. 설치하면 앱 목록에 주말텃밭이 생겨요.",
    "휴대폰 설정 > '모드 및 루틴'을 열고 아래 '루틴' 탭을 누르세요.",
    "오른쪽 위 '+'를 눌러 새 루틴을 만드세요.",
    "'조건 추가(이 경우)' > '장소'를 고르고, 지도에서 텃밭 위치를 지정한 뒤 '도착했을 때'를 선택하세요.",
    "'실행할 동작 추가(이렇게 실행)' > '앱' > '앱 열기' > '주말텃밭'을 고르세요.",
    "루틴 이름을 '텃밭 도착'처럼 정하고 저장하세요.",
  ];
  return (
    <Screen title="밭 도착 시 자동 열기">
      <Link href="/settings" className="text-sm text-primary">
        ← 설정
      </Link>
      <p className="text-sm text-neutral-600">
        갤럭시의 &lsquo;모드 및 루틴&rsquo;을 쓰면 밭에 도착했을 때 주말텃밭이 자동으로 열리고, 오늘 기록이 없으면 빠른 기록 창이 떠요.
      </p>
      <ol className="flex flex-col gap-3 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-lg bg-white p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-white">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-neutral-500">
        메뉴 이름은 One UI 버전에 따라 조금 다를 수 있어요. 앱 안의 도착 확인은 위치 권한을 허용했을 때만 동작하고, 거부하면 조용히 건너뛰어요.
      </p>
    </Screen>
  );
}
