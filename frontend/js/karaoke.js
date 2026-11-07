export function startKaraoke(wordBoundaries, wordElements) {
  const audioPlayer = document.getElementById("player");
  if (!audioPlayer) {
    throw new Error("El reproductor de audio no está disponible.");
  }

  let animationFrameId = null;
  let activeWordIndex = -1;

  const clearHighlights = () => {
    for (const wordElement of wordElements) {
      wordElement.classList.remove("word-highlight");
    }
    activeWordIndex = -1;
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
    if (audioPlayer.paused || audioPlayer.ended) {
      stopSync();
      return;
    }

    let nextActiveWordIndex = -1;
    const currentTime = audioPlayer.currentTime;
    for (let index = 0; index < wordBoundaries.length; index += 1) {
      if (wordBoundaries[index].start <= currentTime) {
        nextActiveWordIndex = index;
      }
    }

    if (nextActiveWordIndex !== activeWordIndex) {
      if (activeWordIndex >= 0) {
        wordElements[activeWordIndex]?.classList.remove("word-highlight");
      }
      wordElements[nextActiveWordIndex]?.classList.add("word-highlight");
      activeWordIndex = nextActiveWordIndex;
    }

    animationFrameId = requestAnimationFrame(syncKaraoke);
  };

  const startSync = () => {
    if (animationFrameId === null && !audioPlayer.paused && !audioPlayer.ended) {
      animationFrameId = requestAnimationFrame(syncKaraoke);
    }
  };

  audioPlayer.addEventListener("play", startSync);
  audioPlayer.addEventListener("pause", stopSync);
  audioPlayer.addEventListener("ended", stopSync);
  startSync();

  return () => {
    audioPlayer.removeEventListener("play", startSync);
    audioPlayer.removeEventListener("pause", stopSync);
    audioPlayer.removeEventListener("ended", stopSync);
    stopSync();
  };
}
