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
    isVoiceEnabled: announcements.isVoiceEnabled,
    setVoiceEnabled: announcements.setVoiceEnabled,
    speak: announcements.speak,
    announceLogin: announcements.announceLogin,
    announceSessionJoined: announcements.announceSessionJoined,
    announceWaiting: announcements.announceWaiting,
    announceDiscussionStart: announcements.announceDiscussionStart,
    announceDiscussionStarted: announcements.announceDiscussionStarted,
    announceBeginSpeaking: announcements.announceBeginSpeaking,
    announceTopic: announcements.announceTopic,
    announceOneMinute: announcements.announceOneMinute,
    announceThirtySeconds: announcements.announceThirtySeconds,
    announceTenSeconds: announcements.announceTenSeconds,
    announceTimeOver: announcements.announceTimeOver,
    announceFinishEarly: announcements.announceFinishEarly,
    announceAllFinished: announcements.announceAllFinished,
    announceEvaluationComplete: announcements.announceEvaluationComplete,
    announceLeaderboardReady: announcements.announceLeaderboardReady,
    announceSessionCreated: announcements.announceSessionCreated,
    announceParticipantJoined: announcements.announceParticipantJoined,
    announceTeamsAssigned: announcements.announceTeamsAssigned,
    announceConnectionLost: announcements.announceConnectionLost,
    announceReconnected: announcements.announceReconnected,
    announceRecordingStarted: announcements.announceRecordingStarted,
    announceRecordingStopped: announcements.announceRecordingStopped,
    announceMeetingStart: announcements.announceMeetingStart,
    announceInterruptionWarning: announcements.announceInterruptionWarning,
    announceFollowUpQuestion: announcements.announceFollowUpQuestion,
    announceMeetingEnded: announcements.announceMeetingEnded,
    announceSpeakerTurn: announcements.announceSpeakerTurn,
    announceLogout: announcements.announceLogout,
    announceYourTurn: announcements.announceYourTurn,
  };
}
