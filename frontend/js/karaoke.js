export function startKaraoke(audio, wordBoundaries, wordSpans) {
  let animationFrameId = null;

  const clearHighlights = () => {
    for (const wordSpan of wordSpans) {
      wordSpan.classList.remove("word-highlight");
    }
  };

  const stopSync = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    clearHighlights();
  };

  const syncKaraoke = () => {
    animationFrameId = null;
    if (audio.paused || audio.ended) {
      stopSync();
      return;
    }

    let activeWordIndex = -1;
    const currentTime = audio.currentTime;
    for (let index = 0; index < wordBoundaries.length; index += 1) {
      if (wordBoundaries[index].start <= currentTime) {
        activeWordIndex = index;
      }
    }

    clearHighlights();
    wordSpans[activeWordIndex]?.classList.add("word-highlight");
    animationFrameId = requestAnimationFrame(syncKaraoke);
  };

  const startSync = () => {
    if (animationFrameId === null && !audio.paused && !audio.ended) {
      animationFrameId = requestAnimationFrame(syncKaraoke);
    }
  };

  audio.addEventListener("play", startSync);
  audio.addEventListener("pause", stopSync);
  audio.addEventListener("ended", stopSync);
  startSync();

  return () => {
    audio.removeEventListener("play", startSync);
    audio.removeEventListener("pause", stopSync);
    audio.removeEventListener("ended", stopSync);
    stopSync();
  };
}
