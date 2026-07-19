"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface Violation {
  id: number;
  timestamp: number;
  event: string;
  duration: number;
}

interface ProctoringConfig {
  maxWarnings: number;
  onWarning: (count: number, event: string) => void;
  onTerminated: (violations: Violation[]) => void;
}

export function useProctoring({
  maxWarnings = 3,
  onWarning,
  onTerminated,
}: ProctoringConfig) {
  const [active, setActive] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState<string | null>(null);
  const violationId = useRef(1);
  const leftAt = useRef(0);
  const terminatedRef = useRef(false);
  const warningCountRef = useRef(0);

  const addViolation = useCallback((event: string) => {
    const now = Date.now();
    const duration = leftAt.current > 0 ? now - leftAt.current : 0;
    const v: Violation = { id: violationId.current++, timestamp: now, event, duration };
    setViolations((prev) => [...prev, v]);
    leftAt.current = now;

    const newCount = warningCountRef.current + 1;
    warningCountRef.current = newCount;
    setWarningCount(newCount);

    if (newCount >= maxWarnings) {
      terminatedRef.current = true;
      onTerminated?.([]);
    } else {
      onWarning?.(newCount, event);
      setShowWarningModal(event);
    }
  }, [maxWarnings, onWarning, onTerminated]);

  const enterFullscreen = useCallback(async () => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {}
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setIsFullscreen(false);
  }, []);

  // Activate proctoring
  const enable = useCallback(() => {
    setActive(true);
    terminatedRef.current = false;
    warningCountRef.current = 0;
    setWarningCount(0);
    setViolations([]);
    enterFullscreen();
  }, [enterFullscreen]);

  // Deactivate
  const disable = useCallback(() => {
    setActive(false);
    exitFullscreen();
    setShowWarningModal(null);
  }, [exitFullscreen]);

  // Fullscreen change detection
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs && !terminatedRef.current) {
        addViolation("Exited fullscreen");
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [active, addViolation]);

  // Visibility API
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      if (document.hidden && !terminatedRef.current) {
        leftAt.current = Date.now();
        addViolation("Tab switched / window minimized");
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [active, addViolation]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+C, Ctrl+V
      const blocked = (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J")) ||
        (e.ctrlKey && (e.key === "U" || e.key === "C" || e.key === "V"))
      );
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        if (!terminatedRef.current) {
          addViolation("Blocked DevTools / copy-paste shortcut");
        }
        return false;
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [active, addViolation]);

  // Right-click prevention
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      if (!terminatedRef.current) {
        addViolation("Right-click attempted");
      }
      return false;
    };
    document.addEventListener("contextmenu", handler, true);
    return () => document.removeEventListener("contextmenu", handler, true);
  }, [active, addViolation]);

  // beforeunload
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      if (!terminatedRef.current) {
        addViolation("Attempted to close / leave page");
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active, addViolation]);

  const dismissWarning = useCallback(() => {
    setShowWarningModal(null);
  }, []);

  return {
    active,
    enable,
    disable,
    isFullscreen,
    warningCount,
    violations,
    showWarningModal,
    dismissWarning,
    enterFullscreen,
    terminated: terminatedRef.current,
  };
}
