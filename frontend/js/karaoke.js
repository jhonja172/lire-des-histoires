export function startKaraoke(wordBoundaries, wordSpans) {
  const audioPlayer = document.getElementById("player");
  if (!audioPlayer) {
    throw new Error("El reproductor de audio no está disponible.");
  }

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
    if (audioPlayer.paused || audioPlayer.ended) {
      stopSync();
      return;
    }

    let activeWordIndex = -1;
    const currentTime = audioPlayer.currentTime;
    for (let index = 0; index < wordBoundaries.length; index += 1) {
      if (wordBoundaries[index].start < currentTime) {
        activeWordIndex = index;
      }
    }

    clearHighlights();
    wordSpans[activeWordIndex]?.classList.add("word-highlight");
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
