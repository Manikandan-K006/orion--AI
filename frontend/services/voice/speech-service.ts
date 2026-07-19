"use client";

let _voice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined") return null;
  const voices = window.speechSynthesis.getVoices();
  const prefs = ["Google US English", "Microsoft Mark", "Microsoft David", "Microsoft Zira"];
  for (const name of prefs) {
    const found = voices.find((v) => v.name === name);
    if (found) return found;
  }
  return voices.find((v) => v.lang.startsWith("en")) || voices[0] || null;
}

export function speakText(text: string, onEnd?: () => void): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.92;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  utterance.lang = "en-US";
  if (!_voice) _voice = pickVoice();
  if (_voice) utterance.voice = _voice;
  if (onEnd) {
    utterance.onend = onEnd;
  }
  window.speechSynthesis.speak(utterance);
  return utterance;
}
