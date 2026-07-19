"use client";

import { useState, useCallback, useEffect } from "react";
import * as announcements from "./voice-announcement";

export function useVoiceAnnouncement() {
  const [enabled, setEnabledState] = useState(announcements.isVoiceEnabled());

  useEffect(() => {
    const stored = localStorage.getItem("mzgd_voice_enabled");
    if (stored !== null) {
      const v = stored === "true";
      announcements.setVoiceEnabled(v);
      setEnabledState(v);
    }
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    announcements.setVoiceEnabled(v);
    localStorage.setItem("mzgd_voice_enabled", v.toString());
    setEnabledState(v);
  }, []);

  return {
    enabled,
    setEnabled,
    ...announcements,
  };
}
