"use client";

import { enqueue, clearQueue } from "./voice-queue";

let enabled = true;

export function setVoiceEnabled(v: boolean) {
  enabled = v;
  if (!v) clearQueue();
}

export function isVoiceEnabled() {
  return enabled;
}

function say(text: string, priority = 0) {
  if (!enabled) return;
  enqueue(text, priority);
}

function sayImmediate(text: string) {
  if (!enabled) return;
  clearQueue();
  enqueue(text, 99);
}

/* ── 1. Login Success ── */
export function announceLogin() {
  say("Welcome to MZ Orator. Your AI Group Discussion platform is ready.");
}

/* ── 2. Entering GD Session ── */
export function announceSessionJoined() {
  say("Welcome to the meeting. You have successfully joined your group discussion session.");
}

/* ── 3. Waiting Room ── */
export function announceWaiting() {
  say("Please wait while your discussion room is being prepared.", 1);
}

/* ── 4. Room Opened (waiting for Start) ── */
export function announceDiscussionStart() {
  sayImmediate("Welcome to the meeting. Please read the discussion topic carefully. Click Start Discussion whenever you are ready.");
}

/* ── 4b. Student clicked Start Discussion ── */
export function announceDiscussionStarted() {
  sayImmediate("You have two minutes to prepare. Read the topic carefully and organize your thoughts.");
}

/* ── 4c. Student starts speaking (after prep) ── */
export function announceBeginSpeaking() {
  sayImmediate("Your discussion has started. You have ten minutes. You may begin speaking now.");
}

/* ── 5. Topic Announcement ── */
export function announceTopic(topic: string) {
  sayImmediate(`Today's discussion topic is: ${topic}`);
}

/* ── 6. One Minute Remaining ── */
export function announceOneMinute() {
  say("One minute remaining. Please conclude your discussion.", 5);
}

/* ── 7. Thirty Seconds Remaining ── */
export function announceThirtySeconds() {
  say("Thirty seconds remaining.", 5);
}

/* ── 8. Ten Seconds Remaining ── */
export function announceTenSeconds() {
  say("Ten seconds remaining.", 5);
}

/* ── 9. Time Over ── */
export function announceTimeOver() {
  sayImmediate("Time is over. Your recording has been submitted for evaluation.");
}

/* ── 10. Finish Early ── */
export function announceFinishEarly() {
  say("Your discussion has been submitted successfully. Please wait while other team members complete their discussion.");
}

/* ── 11. Everyone Finished ── */
export function announceAllFinished() {
  say("All participants have completed the discussion. AI evaluation is now in progress.");
}

/* ── 12. AI Evaluation Complete ── */
export function announceEvaluationComplete() {
  say("Your evaluation is complete. Your performance report is now available.");
}

/* ── 13. Leaderboard Ready ── */
export function announceLeaderboardReady() {
  say("The team leaderboard has been generated.");
}

/* ── 14. Admin Creates Session ── */
export function announceSessionCreated() {
  say("A new discussion session has been created successfully.");
}

/* ── 15. Participants Joined (Admin only) ── */
export function announceParticipantJoined() {
  say("A new participant has joined the session.");
}

/* ── 16. Team Formation Complete ── */
export function announceTeamsAssigned() {
  say("Teams have been assigned successfully.");
}

/* ── 17. Connection Lost ── */
export function announceConnectionLost() {
  say("Connection interrupted. Attempting to reconnect.", 10);
}

/* ── 18. Reconnected ── */
export function announceReconnected() {
  say("Connection restored.", 10);
}

/* ── 19. Recording Started ── */
export function announceRecordingStarted() {
  say("Recording has started.");
}

/* ── 20. Recording Stopped ── */
export function announceRecordingStopped() {
  say("Recording has stopped.");
}

/* ── 21. User Workflow Specific AI Announcements ── */
export function announceMeetingStart(topic: string, firstSpeaker: string) {
  sayImmediate(`Welcome everyone. Today's topic is ${topic}. You have 10 minutes. ${firstSpeaker}, please start.`);
}

export function announceInterruptionWarning(currentSpeaker: string) {
  sayImmediate(`Please allow ${currentSpeaker} to complete.`);
}

export function announceFollowUpQuestion(studentName?: string) {
  if (studentName) {
    say(`${studentName}, what is your opinion?`, 5);
  } else {
    say("Can anyone provide an example?", 5);
  }
}

export function announceMeetingEnded() {
  sayImmediate("Discussion completed. Thank you.");
}

export function announceSpeakerTurn(speakerName: string) {
  sayImmediate(`${speakerName}, it is now your turn to speak. You have 2 minutes.`);
}

export function announceYourTurn() {
  sayImmediate("It is now your turn to speak. You have two minutes.");
}

export function announceLogout() {
  say("Thank you for using MZ Orator. Have a great day.");
}
