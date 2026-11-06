export function startKaraoke(audio, wordBoundaries) {
  const words = Array.from(document.querySelectorAll(".story-word"));
  const boundaries = wordBoundaries
    .filter((boundary) => Number.isFinite(boundary.start))
    .sort((first, second) => first.start - second.start);
  let animationFrame = null;
  let highlightedWord = null;
  let active = true;

  const clearHighlight = () => {
    if (highlightedWord) {
      highlightedWord.classList.remove("word-highlight");
      highlightedWord = null;
    }
  };

  const update = () => {
    if (!active) {
      return;
    }

    const currentTime = audio.currentTime;
    let activeIndex = -1;
    for (let index = 0; index < boundaries.length; index += 1) {
      if (boundaries[index].start > currentTime) {
        break;
      }
      activeIndex = index;
    }

    const nextWord = activeIndex >= 0 ? words[activeIndex] : null;
    if (nextWord !== highlightedWord) {
      clearHighlight();
      if (nextWord) {
        nextWord.classList.add("word-highlight");
        highlightedWord = nextWord;
      }
    }

    if (!audio.paused && !audio.ended) {
      animationFrame = requestAnimationFrame(update);
    } else {
      clearHighlight();
    }
  };

  animationFrame = requestAnimationFrame(update);

  return () => {
    active = false;
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
    clearHighlight();
  };
}
