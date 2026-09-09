import { ContentPair, TimelineManifest, TimelinePair } from '../types';

export function calculateTimeline(
  pairs: ContentPair[],
  viDurations: number[],
  enDurations: number[],
  tickDuration = 2.11
): TimelineManifest {
  const timelinePairs: TimelinePair[] = [];
  let currentTime = 0;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const pairStartTime = currentTime;

    // 1. VI sentence starts at currentTime
    const viStartTime = currentTime;
    const viDuration = viDurations[i] || 2.0;
    const viEndTime = viStartTime + viDuration;

    // 2. Pause 0.22s
    const tickStartTime = viEndTime + 0.22;

    // 3. Tick plays for exact 2.11s (EN answer remains hidden)
    const tickEndTime = tickStartTime + tickDuration;

    // 4. Tick ends -> EN answer revealed
    const enRevealTime = tickEndTime;

    // 5. Wait 0.45s after reveal before playing EN audio
    const enStartTime = enRevealTime + 0.45;

    // 6. EN audio plays
    const enDuration = enDurations[i] || 2.0;
    const enEndTime = enStartTime + enDuration;

    // 7. Hold answer for at least 0.18s after EN audio finishes
    const pairEndTime = enEndTime + 0.18;

    timelinePairs.push({
      pairIndex: i,
      vi: pair.vi,
      en: pair.en,
      pairStartTime,
      viStartTime,
      viDuration,
      viEndTime,
      tickStartTime,
      tickDuration,
      tickEndTime,
      enRevealTime,
      enStartTime,
      enDuration,
      enEndTime,
      pairEndTime,
    });

    currentTime = pairEndTime;
  }

  return {
    totalDuration: Math.ceil(currentTime * 100) / 100, // round to 2 decimals
    pairs: timelinePairs,
  };
}
