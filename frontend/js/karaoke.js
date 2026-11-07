export function startKaraoke(wordElements) {
  const audioPlayer = document.getElementById("player");
  if (!audioPlayer) {
    throw new Error("El reproductor de audio no está disponible.");
  }
  if (!Array.isArray(window.wordBoundaries)) {
    throw new Error("No se encontraron los tiempos de las palabras del audio.");
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

  const updateActiveWord = () => {
    console.log("Sincronizando... Tiempo actual:", audioPlayer.currentTime);
    if (audioPlayer.paused || audioPlayer.ended) {
      return;
    }

    let nextActiveWordIndex = -1;
    const currentTime = audioPlayer.currentTime;
    const wordBoundaries = window.wordBoundaries;
    if (!Array.isArray(wordBoundaries)) {
      return;
    }
    console.log("Array de tiempos:", wordBoundaries);
    for (let index = 0; index < wordBoundaries.length; index += 1) {
      if (currentTime >= wordBoundaries[index].start) {
        nextActiveWordIndex = index;
      }
    }

    if (nextActiveWordIndex !== activeWordIndex) {
      if (nextActiveWordIndex >= 0) {
        console.log("Palabra activa encontrada:", wordBoundaries[nextActiveWordIndex].text);
      }
      for (const wordElement of wordElements) {
        wordElement.classList.remove("word-highlight");
      }
      wordElements[nextActiveWordIndex]?.classList.add("word-highlight");
      activeWordIndex = nextActiveWordIndex;
    }
  };

  const syncKaraoke = () => {
    animationFrameId = null;
    if (audioPlayer.paused || audioPlayer.ended) {
      stopSync();
      return;
    }

    updateActiveWord();
    animationFrameId = requestAnimationFrame(syncKaraoke);
  };

  const startSync = () => {
    if (animationFrameId === null && !audioPlayer.paused && !audioPlayer.ended) {
      animationFrameId = requestAnimationFrame(syncKaraoke);
    }
  };

  audioPlayer.addEventListener("play", startSync);
  audioPlayer.addEventListener("timeupdate", updateActiveWord);
  audioPlayer.addEventListener("pause", stopSync);
  audioPlayer.addEventListener("ended", stopSync);
  startSync();

  return () => {
    audioPlayer.removeEventListener("play", startSync);
    audioPlayer.removeEventListener("timeupdate", updateActiveWord);
    audioPlayer.removeEventListener("pause", stopSync);
    audioPlayer.removeEventListener("ended", stopSync);
    stopSync();
  };
}
