function normalizeWord(value) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function startKaraoke(audio, wordBoundaries) {
  const words = Array.from(document.querySelectorAll(".line-french .story-word"));
  const boundaries = wordBoundaries
    .filter((boundary) => Number.isFinite(boundary.start))
    .sort((first, second) => first.start - second.start);
  let nextWordIndex = 0;
  let highlightedWord = null;
  let active = true;

  const mappedBoundaries = boundaries.map((boundary) => {
    const boundaryWord = normalizeWord(boundary.text ?? "");
    let wordIndex = nextWordIndex;

    if (boundaryWord) {
      const matchIndex = words.findIndex((word, index) => {
        if (index < nextWordIndex) {
          return false;
        }
        const storyWord = normalizeWord(word.textContent);
        return storyWord === boundaryWord
          || storyWord.includes(boundaryWord)
          || boundaryWord.includes(storyWord);
      });
      if (matchIndex >= 0) {
        wordIndex = matchIndex;
      }
    }

    const mappedWord = words[wordIndex] ?? null;
    if (mappedWord) {
      const storyWord = normalizeWord(mappedWord.textContent);
      nextWordIndex = storyWord === boundaryWord ? wordIndex + 1 : wordIndex;
    }

    return { start: boundary.start, word: mappedWord };
  });

  const clearHighlight = () => {
    if (highlightedWord) {
      highlightedWord.classList.remove("word-highlight");
      highlightedWord = null;
    }
  };

  const updateHighlight = () => {
    if (!active || audio.paused || audio.ended) {
      clearHighlight();
      return;
    }

    let activeBoundary = null;
    for (const boundary of mappedBoundaries) {
      if (boundary.start > audio.currentTime) {
        break;
      }
      activeBoundary = boundary;
    }

    const nextWord = activeBoundary?.word ?? null;
    if (nextWord !== highlightedWord) {
      clearHighlight();
      if (nextWord) {
        nextWord.classList.add("word-highlight");
        highlightedWord = nextWord;
      }
    }
  };

  audio.addEventListener("timeupdate", updateHighlight);
  audio.addEventListener("seeking", updateHighlight);
  audio.addEventListener("play", updateHighlight);
  audio.addEventListener("pause", clearHighlight);
  audio.addEventListener("ended", clearHighlight);
  updateHighlight();

  return () => {
    active = false;
    audio.removeEventListener("timeupdate", updateHighlight);
    audio.removeEventListener("seeking", updateHighlight);
    audio.removeEventListener("play", updateHighlight);
    audio.removeEventListener("pause", clearHighlight);
    audio.removeEventListener("ended", clearHighlight);
    clearHighlight();
  };
}
