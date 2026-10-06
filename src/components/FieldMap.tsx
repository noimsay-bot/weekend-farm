"use client";

// 밭 그림: 흙(고랑) 위에 두둑·네모 밭을 놓고, 심은 작물은 포기 위치에 원으로 그린다.
// 격자는 자 역할만 한다. 새로 놓거나 고치는 구획(floating)은 위에 떠 있는 상자로 그려
// 끌어 옮기고 오른쪽 아래 손잡이로 크기를 바꾼다. 10cm 격자와 다른 구획·밭 가장자리에 자석처럼 붙는다.
// 고정된 구획은 길게 누르면(onLongPressBed) 떠 있는 상자가 되어 그대로 끌어 옮길 수 있다.
import { useRef, useState } from "react";
import { plantCountOf, plantPositions, scatterPoints, segmentRect, sowLines, type Bed, type BedPlanting } from "@/lib/field/beds";
import { snapMove, snapResize, STEP_CM } from "@/lib/field/layout";
import { toneMap } from "@/lib/field/colors";

export type FieldMarker = "todo" | "warn";

type Props = {
  widthCm: number;
  heightCm: number;
  beds: Bed[];
  plantings: BedPlanting[];
  cropNames: Record<string, string>;
  spacingOf?: (cropId: string) => number | null;
  markers?: Record<string, FieldMarker>; // bed planting id → 표시
  warned?: Set<string>; // 연작 등 경고가 있는 bed planting id
  selectedBedId?: string | null;
  mode?: "view" | "layout" | "plant";
  onSelectBed?: (bedId: string | null) => void;
  onSelectPlanting?: (plantingId: string) => void;
  onBedChange?: (bed: Bed) => void;
  floating?: Bed | null; // 아직 고정하지 않은 상자
  onFloatingChange?: (bed: Bed) => void;
  onLongPressBed?: (bedId: string) => void; // 길게 눌러 옮기기·크기 바꾸기 (계획 확정 전)
};

// 길게 누르기 판정 시간과 허용 흔들림(cm 아닌 화면 px)
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

type Drag = { id: string; kind: "move" | "resize"; startX: number; startY: number; orig: Bed };

export function FieldMap({
  widthCm,
  heightCm,
  beds,
  plantings,
  cropNames,
  spacingOf = () => null,
  markers = {},
  warned = new Set(),
  selectedBedId = null,
  mode = "view",
  onSelectBed,
  onSelectPlanting,
  onBedChange,
  floating = null,
  onFloatingChange,
  onLongPressBed,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Bed | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }

  // 구획을 누르고 있으면 잠시 뒤 떠 있는 상자로 바꾸고, 같은 손가락으로 바로 끌어 옮긴다.
  function startPress(e: React.PointerEvent, bed: Bed) {
    if (!onLongPressBed || floating) return;
    cancelPress();
    const target = e.currentTarget as Element;
    const pointerId = e.pointerId;
    const start = toCm(e);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // 합성 이벤트 등 캡처할 수 없는 경우는 그냥 둔다
    }
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        navigator.vibrate?.(30);
        onLongPressBed(bed.id);
        setDrag({ id: bed.id, kind: "move", startX: start.x, startY: start.y, orig: bed });
        setDraft(bed);
      }, LONG_PRESS_MS),
    };
  }
  const unit = Math.max(widthCm, heightCm) / 60; // 글자·선 굵기 기준

  function toCm(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }

  function startDrag(e: React.PointerEvent, bed: Bed, kind: Drag["kind"]) {
    e.stopPropagation();
    const isFloating = floating !== null && bed.id === floating.id;
    if (!isFloating) onSelectBed?.(bed.id);
    if (mode !== "layout" && !isFloating) return;
    const p = toCm(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: bed.id, kind, startX: p.x, startY: p.y, orig: bed });
    setDraft(bed);
  }

  function onMove(e: React.PointerEvent) {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP_PX) cancelPress();
    if (!drag) return;
    const p = toCm(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const o = drag.orig;
    const others = beds.filter((b) => b.id !== o.id);
    const field = { w: widthCm, h: heightCm };
    const next: Bed =
      drag.kind === "move"
        ? { ...o, ...snapMove({ ...o, x_cm: o.x_cm + dx, y_cm: o.y_cm + dy }, others, field) }
        : { ...o, ...snapResize({ ...o, w_cm: o.w_cm + dx, h_cm: o.h_cm + dy }, others, field) };
    setDraft(next);
    if (floating && drag.id === floating.id) onFloatingChange?.(next);
  }

  function endDrag() {
    cancelPress();
    if (drag && draft && !(floating && drag.id === floating.id) && (draft.x_cm !== drag.orig.x_cm || draft.y_cm !== drag.orig.y_cm || draft.w_cm !== drag.orig.w_cm || draft.h_cm !== drag.orig.h_cm)) {
      onBedChange?.(draft);
    }
    setDrag(null);
    setDraft(null);
  }

  // 고치는 중인 구획은 원래 자리에서 빼고 떠 있는 상자로만 그린다
  const shown = beds.filter((b) => !floating || b.id !== floating.id).map((b) => (draft && b.id === draft.id ? draft : b));
  const box = floating ? (draft && draft.id === floating.id ? draft : floating) : null;
  const bedById = new Map(shown.map((b) => [b.id, b]));
  const tones = toneMap(plantings.map((p) => p.crop_id));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${widthCm} ${heightCm}`}
      className="block w-full select-none"
      style={{ aspectRatio: `${widthCm} / ${heightCm}`, touchAction: mode === "layout" || floating ? "none" : "auto" }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={() => !floating && onSelectBed?.(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect x={0} y={0} width={widthCm} height={heightCm} rx={unit * 0.8} fill="var(--soil)" />
      {/* 1m 눈금 */}
      {Array.from({ length: Math.floor(widthCm / 100) }, (_, i) => (
        <line key={`vx${i}`} x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={heightCm} stroke="#e7e1d1" strokeWidth={unit * 0.08} />
      ))}
      {Array.from({ length: Math.floor(heightCm / 100) }, (_, i) => (
        <line key={`hy${i}`} x1={0} y1={(i + 1) * 100} x2={widthCm} y2={(i + 1) * 100} stroke="#e7e1d1" strokeWidth={unit * 0.08} />
      ))}
      {/* 상자를 놓는 동안 10cm 보조 눈금 */}
      {(floating || drag) &&
        widthCm / STEP_CM <= 300 &&
        heightCm / STEP_CM <= 300 && (
          <g pointerEvents="none" stroke="#efe9db" strokeWidth={unit * 0.04}>
            {Array.from({ length: Math.floor(widthCm / STEP_CM) }, (_, i) =>
              (i + 1) % 10 ? <line key={`mx${i}`} x1={(i + 1) * STEP_CM} y1={0} x2={(i + 1) * STEP_CM} y2={heightCm} /> : null,
            )}
            {Array.from({ length: Math.floor(heightCm / STEP_CM) }, (_, i) =>
              (i + 1) % 10 ? <line key={`my${i}`} x1={0} y1={(i + 1) * STEP_CM} x2={widthCm} y2={(i + 1) * STEP_CM} /> : null,
            )}
          </g>
        )}
      {/* 자 눈금 (m) */}
      {Array.from({ length: Math.floor((widthCm - 1) / 100) }, (_, i) => (
        <text key={`rx${i}`} x={(i + 1) * 100} y={unit * 1.2} fontSize={unit * 0.9} textAnchor="middle" fill="#b9ae93" pointerEvents="none">
          {i + 1}m
        </text>
      ))}
      {Array.from({ length: Math.floor((heightCm - 1) / 100) }, (_, i) => (
        <text key={`ry${i}`} x={unit * 0.4} y={(i + 1) * 100} fontSize={unit * 0.9} dominantBaseline="central" fill="#b9ae93" pointerEvents="none">
          {i + 1}m
        </text>
      ))}

      {shown.map((b) => {
        const selected = b.id === selectedBedId;
        return (
          <g key={b.id}>
            <rect
              x={b.x_cm}
              y={b.y_cm}
              width={b.w_cm}
              height={b.h_cm}
              rx={Math.min(b.w_cm, b.h_cm) * 0.12}
              fill={b.kind === "plot" ? "#ece5d2" : "var(--bed)"}
              stroke={selected ? "var(--primary)" : "var(--bed-line)"}
              strokeWidth={selected ? unit * 0.35 : unit * 0.12}
              strokeDasharray={b.kind === "plot" ? `${unit * 0.6} ${unit * 0.4}` : undefined}
              style={{ cursor: mode === "layout" ? "move" : "pointer", touchAction: onLongPressBed ? "none" : undefined }}
              onPointerDown={(e) => {
                startDrag(e, b, "move");
                startPress(e, b);
              }}
            />
          </g>
        );
      })}

      {plantings.map((p) => {
        const b = bedById.get(p.bed_id);
        if (!b) return null;
        const r = segmentRect(b, p);
        const tone = tones.get(p.crop_id)!;
        const count = plantCountOf(b, p, spacingOf(p.crop_id));
        const pts = plantPositions(b, p, Math.min(count, 400));
        const lines = p.method === "row" ? sowLines(b, p) : [];
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        const seeds = p.method === "broadcast" ? scatterPoints(r, Math.min(160, Math.max(12, Math.round(area / (unit * unit * 1.2))))) : [];
        const short = Math.min(r.x1 - r.x0, r.y1 - r.y0);
        const gap = pts.length > 1 ? Math.min(...pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y))) : short;
        const radius = Math.max(unit * 0.25, Math.min(gap * 0.38, short / (b.kind === "plot" ? 3 : p.rows * 2.6), unit * 1.6));
        const marker = markers[p.id];
        const isWarned = warned.has(p.id);
        return (
          <g
            key={p.id}
            style={{ cursor: "pointer", pointerEvents: mode === "layout" ? "none" : "auto", touchAction: onLongPressBed ? "none" : undefined }}
            onPointerDown={(e) => {
              e.stopPropagation();
              startPress(e, b);
              onSelectBed?.(b.id);
              onSelectPlanting?.(p.id);
            }}
          >
            <rect
              x={r.x0 + unit * 0.15}
              y={r.y0 + unit * 0.15}
              width={Math.max(0, r.x1 - r.x0 - unit * 0.3)}
              height={Math.max(0, r.y1 - r.y0 - unit * 0.3)}
              rx={short * 0.1}
              fill={tone.fill}
              opacity={p.carried_from_planting_id ? 0.5 : 0.85}
              stroke={isWarned ? "var(--danger)" : "none"}
              strokeWidth={unit * 0.25}
            />
            {lines.map((l, i) => (
              <line key={`l${i}`} {...l} stroke={tone.stroke} strokeWidth={unit * 0.28} strokeDasharray={`${unit * 0.35} ${unit * 0.25}`} strokeLinecap="round" />
            ))}
            {seeds.map((q, i) => (
              <circle key={`s${i}`} cx={q.x} cy={q.y} r={unit * 0.16} fill={tone.stroke} />
            ))}
            {pts.map((q, i) => (
              <circle key={i} cx={q.x} cy={q.y} r={radius} fill="#ffffff" stroke={tone.stroke} strokeWidth={Math.max(unit * 0.1, radius * 0.22)} />
            ))}
            {short > unit * 1.4 && (
              <text
                x={(r.x0 + r.x1) / 2}
                y={(r.y0 + r.y1) / 2}
                fontSize={Math.min(unit * 1.25, short * 0.42)}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                fill={tone.stroke}
                stroke="#ffffff"
                strokeWidth={unit * 0.25}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {cropNames[p.crop_id] ?? ""}
              </text>
            )}
            {marker && (
              <circle
                cx={r.x1 - unit * 0.4}
                cy={r.y0 + unit * 0.4}
                r={unit * 0.7}
                fill={marker === "warn" ? "var(--danger)" : "var(--primary)"}
                stroke="#ffffff"
                strokeWidth={unit * 0.25}
              />
            )}
          </g>
        );
      })}

      {mode === "layout" &&
        shown
          .filter((b) => b.id === selectedBedId)
          .map((b) => (
            <g key={`h-${b.id}`}>
              <circle
                cx={b.x_cm + b.w_cm}
                cy={b.y_cm + b.h_cm}
                r={unit * 1.1}
                fill="var(--primary)"
                stroke="#ffffff"
                strokeWidth={unit * 0.3}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => startDrag(e, b, "resize")}
              />
              <text
                x={b.x_cm + b.w_cm / 2}
                y={b.y_cm - unit * 0.5}
                fontSize={unit * 1.05}
                textAnchor="middle"
                fill="var(--primary)"
                stroke="#ffffff"
                strokeWidth={unit * 0.3}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {b.w_cm}×{b.h_cm}cm
              </text>
            </g>
          ))}

      {box && (
        <g>
          <rect
            x={box.x_cm}
            y={box.y_cm}
            width={box.w_cm}
            height={box.h_cm}
            rx={Math.min(box.w_cm, box.h_cm) * 0.12}
            fill="var(--primary)"
            fillOpacity={0.18}
            stroke="var(--primary)"
            strokeWidth={unit * 0.3}
            strokeDasharray={`${unit * 0.8} ${unit * 0.5}`}
            style={{ cursor: "move" }}
            onPointerDown={(e) => startDrag(e, box, "move")}
          />
          <text
            x={box.x_cm + box.w_cm / 2}
            y={box.y_cm + box.h_cm / 2}
            fontSize={Math.min(unit * 1.2, Math.min(box.w_cm, box.h_cm) * 0.35)}
            fontWeight={600}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--primary)"
            stroke="#ffffff"
            strokeWidth={unit * 0.3}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {box.w_cm}×{box.h_cm}cm
          </text>
          <circle
            cx={box.x_cm + box.w_cm}
            cy={box.y_cm + box.h_cm}
            r={unit * 1.4}
            fill="var(--primary)"
            stroke="#ffffff"
            strokeWidth={unit * 0.3}
            style={{ cursor: "nwse-resize" }}
            onPointerDown={(e) => startDrag(e, box, "resize")}
          />
        </g>
      )}
    </svg>
  );
}
