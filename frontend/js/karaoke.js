function normalizeWord(value) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function startKaraoke(audio, wordBoundaries) {
  const words = Array.from(document.querySelectorAll(".line-french .story-word"));
  const boundaries = wordBoundaries
    .filter((boundary) => (
      Number.isFinite(boundary.start)
      && Number.isFinite(boundary.duration)
      && boundary.duration > 0
    ))
    .sort((first, second) => first.start - second.start);
  let nextWordIndex = 0;
  let active = true;

  const mappedBoundaries = boundaries.map((boundary) => {
    const boundaryWord = normalizeWord(boundary.text ?? "");
    let wordIndex = nextWordIndex;

    if (boundaryWord) {
      const matchIndex = words.findIndex((word, index) => (
        index >= nextWordIndex
        && normalizeWord(word.textContent) === boundaryWord
      ));
      if (matchIndex >= 0) {
        wordIndex = matchIndex;
      }
    }

    const word = words[wordIndex] ?? null;
    if (word) {
      nextWordIndex = wordIndex + 1;
    }
    return { start: boundary.start, duration: boundary.duration, word };
  });

  const clearHighlights = () => {
    document.querySelectorAll(".word-highlight").forEach((element) => {
      element.classList.remove("word-highlight");
    });
  };

  const updateHighlight = () => {
    clearHighlights();
    if (!active || audio.paused || audio.ended) {
      return;
    }

    const currentTime = audio.currentTime;
    const activeBoundary = mappedBoundaries.find((boundary) => (
      boundary.start <= currentTime
      && boundary.start + boundary.duration > currentTime
    ));
    activeBoundary?.word?.classList.add("word-highlight");
  };

  audio.addEventListener("timeupdate", updateHighlight);
  audio.addEventListener("seeking", updateHighlight);
  audio.addEventListener("play", updateHighlight);
  audio.addEventListener("pause", clearHighlights);
  audio.addEventListener("ended", clearHighlights);
  updateHighlight();

  return () => {
    active = false;
    audio.removeEventListener("timeupdate", updateHighlight);
    audio.removeEventListener("seeking", updateHighlight);
    audio.removeEventListener("play", updateHighlight);
    audio.removeEventListener("pause", clearHighlights);
    audio.removeEventListener("ended", clearHighlights);
    clearHighlights();
  };
}
