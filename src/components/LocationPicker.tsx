"use client";

import { useEffect, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button, ErrorText } from "@/components/ui";
import { geocode, type GeocodeResult } from "@/lib/geocode";

export type LatLng = { lat: number; lng: number };

const KOREA_CENTER: LatLng = { lat: 36.3, lng: 127.8 };

// 무료 지도: OpenStreetMap 타일 + Leaflet. 지도를 탭하거나 주소를 검색해 위치를 고른다.
export function LocationPicker({
  value,
  onChange,
}: {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    // leaflet은 window를 참조하므로 클라이언트에서만 불러온다.
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([KOREA_CENTER.lat, KOREA_CENTER.lng], 7);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      map.on("click", (e) => onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // 선택된 위치에 표시를 옮긴다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    import("leaflet").then((L) => {
      if (markerRef.current) {
        markerRef.current.setLatLng([value.lat, value.lng]);
      } else {
        markerRef.current = L.circleMarker([value.lat, value.lng], {
          radius: 10,
          color: "#ffffff",
          weight: 3,
          fillColor: "#3f7d3a",
          fillOpacity: 1,
        }).addTo(map);
      }
    });
  }, [value]);

  function moveTo(next: LatLng, zoom = 17) {
    onChange(next);
    mapRef.current?.setView([next.lat, next.lng], zoom);
  }

  function fillCurrentLocation() {
    if (!("geolocation" in navigator)) return setError("이 기기에서는 현재 위치를 쓸 수 없어요.");
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        moveTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setError("현재 위치를 가져오지 못했어요. 주소 검색이나 지도 탭으로 골라 주세요.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    setNotice("");
    try {
      const { results, matchedName } = await geocode(query);
      setResults(results);
      if (results.length === 0) {
        setError("검색 결과가 없어요. 동·읍·면·리 이름으로 찾고 지도를 탭해 보세요.");
      } else if (matchedName) {
        setNotice(`번지까지는 못 찾아서 '${matchedName}'로 찾았어요. 고른 뒤 지도에서 밭 자리를 탭하세요.`);
      }
    } catch {
      setError("검색하지 못했어요. 지도를 직접 탭해 주세요.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="secondary" onClick={fillCurrentLocation} disabled={locating}>
        {locating ? "위치 찾는 중…" : "현재 위치로 설정"}
      </Button>

      <form onSubmit={search} className="flex gap-2">
        <input
          className="h-12 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-base"
          placeholder="주소나 동네 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="h-12 shrink-0 rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-50"
          disabled={searching}
        >
          검색
        </button>
      </form>

      {results.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border border-neutral-300 bg-white text-sm">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                className="w-full px-3 py-3 text-left"
                onClick={() => {
                  moveTo({ lat: Number(r.lat), lng: Number(r.lon) }, 16);
                  setResults([]);
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="text-sm text-neutral-600">{notice}</p>}
      <ErrorText>{error}</ErrorText>

      <div
        ref={containerRef}
        className="z-0 h-72 w-full overflow-hidden rounded-lg border border-neutral-300"
      />
      <p className="text-xs text-neutral-500">
        {value ? "지도를 탭하면 위치를 옮길 수 있어요." : "지도에서 텃밭 자리를 탭하세요."}
      </p>
    </div>
  );
}
