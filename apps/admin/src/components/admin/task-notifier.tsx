"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 30_000;

export function TaskNotifier() {
  const [count, setCount] = useState(0);
  const prevRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews/pending-count", { cache: "no-store" });
      if (!res.ok) return;
      const { count: latest } = (await res.json()) as { count: number };
      setCount(latest);

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
    } catch {
      /* network error — silent retry next cycle */
    }
  }, []);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <>
      {/* Short notification tone (data URI to avoid external dependency) */}
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
