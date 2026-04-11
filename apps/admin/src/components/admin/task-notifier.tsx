"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const POLL_INTERVAL = 30_000;

let currentCount = 0;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentCount;
}

async function fetchPendingCount(
  prevRef: React.RefObject<number>,
  audioRef: React.RefObject<HTMLAudioElement | null>,
) {
  try {
    const res = await fetch("/api/reviews/pending-count", { cache: "no-store" });
    if (!res.ok) return;
    const { count: latest } = (await res.json()) as { count: number };

    if (latest > prevRef.current && prevRef.current >= 0) {
      audioRef.current?.play().catch(() => {});
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification("稽核后台", {
          body: `有 ${latest} 条待处理任务`,
          tag: "pending-tasks",
        });
      }
    }
    prevRef.current = latest;
    currentCount = latest;
    listeners.forEach((cb) => cb());
  } catch {
    /* network error — silent retry next cycle */
  }
}

export function TaskNotifier() {
  const count = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  const prevRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    fetchPendingCount(prevRef, audioRef);
    const id = setInterval(() => fetchPendingCount(prevRef, audioRef), POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="
        preload="auto"
      />
      {count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </>
  );
}
