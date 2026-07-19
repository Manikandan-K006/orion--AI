"use client";

import { speakText } from "./speech-service";

type QueueItem = { text: string; priority: number };

const queue: QueueItem[] = [];
let speaking = false;

export function enqueue(text: string, priority = 0) {
  queue.push({ text, priority });
  queue.sort((a, b) => b.priority - a.priority);
  processNext();
}

function processNext() {
  if (speaking || queue.length === 0) return;
  speaking = true;
  const item = queue.shift()!;
  speakText(item.text, () => {
    speaking = false;
    processNext();
  });
}

export function clearQueue() {
  queue.length = 0;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  speaking = false;
}

export function getQueueLength() {
  return queue.length;
}
