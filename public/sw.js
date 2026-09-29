// 주말텃밭 service worker.
// 오프라인 캐시는 요구 범위가 아니라 두지 않는다. 푸시 수신 처리는 P6에서 추가한다.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
