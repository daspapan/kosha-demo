"use client";

import { useEffect, useRef, useState } from "react";
import { duration } from "@/lib/format";

/**
 * Counts down to a chain timestamp. The demo chain can be time-travelled, so "now" is chain time, not the
 * computer clock. Each new block tells us chain time is at least that block's timestamp, so we keep the
 * largest offset we have seen between chain time and the computer clock.
 */
export function Countdown({ until, chainNow }: { until: number; chainNow: number }) {
  const offset = useRef<number | null>(null);
  const wall = () => Math.floor(Date.now() / 1000);
  const seen = chainNow - wall();
  if (offset.current === null || seen > offset.current) offset.current = seen;

  const [now, setNow] = useState(() => wall() + (offset.current ?? 0));
  useEffect(() => {
    const t = setInterval(() => setNow(wall() + (offset.current ?? 0)), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="num">{duration(until - now)}</span>;
}
