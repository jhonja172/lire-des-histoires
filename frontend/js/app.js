import { getStories, saveStory } from "./storage.js";
import { startKaraoke } from "./karaoke.js";
import { getFlashcards, saveFlashcard } from "./supabase.js";

const API_URL = "https://lire-des-histoires.onrender.com";
const homeScreen = document.querySelector("#home-screen");
const libraryScreen = document.querySelector("#library-screen");
const readerScreen = document.querySelector("#reader-screen");
const addScreen = document.querySelector("#add-screen");
const flashcardsScreen = document.querySelector("#flashcards-screen");
const storyList = document.querySelector("#story-list");
const emptyLibrary = document.querySelector("#empty-library");
const statusMessage = document.querySelector("#status-message");
const openLibraryButton = document.querySelector("#open-library-button");
const openFlashcardsButton = document.querySelector("#open-flashcards-button");
const addTextButton = document.querySelector("#add-text-button");
const backHomeFromLibraryButton = document.querySelector("#back-home-from-library");
const backHomeFromFlashcardsButton = document.querySelector("#back-home-from-flashcards");
const backToLibraryButton = document.querySelector("#back-to-library");
const cancelAddButton = document.querySelector("#cancel-add-button");
const storyForm = document.querySelector("#story-form");
const storyText = document.querySelector("#story-text");
const saveButton = document.querySelector("#save-button");
const readerTitle = document.querySelector("#reader-title");
const readerLines = document.querySelector("#reader-lines");
const playButton = document.querySelector("#play-button");
const translateButton = document.querySelector("#translate-button");
const speedSelect = document.querySelector("#speed-select");
const dictionaryModal = document.querySelector("#dictionary-modal");
const modalWord = document.querySelector("#modal-word");
const modalTranslation = document.querySelector("#modal-translation");
const closeDictionaryModalButton = document.querySelector("#close-dictionary-modal");
const saveDictionaryFlashcardButton = document.querySelector("#save-dictionary-flashcard-button");
const flashcardPanel = document.querySelector("#flashcard-panel");
const flashcardCount = document.querySelector("#flashcard-count");
const flashcardFrench = document.querySelector("#flashcard-french");
const flashcardAudioButton = document.querySelector("#flashcard-audio-button");
const flashcardAnswerForm = document.querySelector("#flashcard-answer-form");
const flashcardAnswer = document.querySelector("#flashcard-answer");
const flashcardFeedback = document.querySelector("#flashcard-feedback");
const flashcardsEmpty = document.querySelector("#flashcards-empty");
const audioPlayer = document.getElementById("player");
if (!audioPlayer) {
  throw new Error("No se encontró el reproductor de audio.");
}
window.audioPlayer = audioPlayer;

let stories = [];
let currentStoryText = "";
let currentAudioText = null;
let currentAudioUrl = null;
let currentAudioBase64 = null;
let currentWordBoundaries = [];
window.wordBoundaries = currentWordBoundaries;
let wordElements = [];
let flashcards = [];
let currentFlashcardIndex = 0;
let flashcardAudioUrl = null;
let stopKaraoke = () => {};
let translationController = null;
let wordLookupController = null;
let currentDictionaryLine = null;
let currentDictionaryWord = "";

async function readApiError(response) {
  const body = await response.text();
  if (!body) {
    return `Error del servidor (${response.status}).`;
  }

  try {
    const details = JSON.parse(body);
    if (typeof details?.detail === "string") {
      return details.detail;
    }
    return details?.message ?? `Error del servidor (${response.status}).`;
  } catch {
    return body;
  }
}

async function postApi(path, text, signal) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return response.json();
}

async function postFlashcardApi(word, paragraph) {
  const response = await fetch(`${API_URL}/api/generate_flashcard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, paragraph }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return response.json();
}

async function translateText(text, parentSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const result = await postApi("/api/translate", text, controller.signal);
    if (typeof result.translation !== "string") {
      throw new Error("El servidor devolvió una traducción inválida.");
    }
    return result.translation;
  } catch (error) {
    if (controller.signal.aborted && !parentSignal?.aborted) {
      throw new Error("La traducción tardó más de 2 minutos y se canceló.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function showScreen(screenName) {
  homeScreen.hidden = screenName !== "home";
  libraryScreen.hidden = screenName !== "library";
  readerScreen.hidden = screenName !== "reader";
  addScreen.hidden = screenName !== "add";
  flashcardsScreen.hidden = screenName !== "flashcards";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  if (isError) {
    statusMessage.dataset.state = "error";
  } else {
    statusMessage.removeAttribute("data-state");
  }
}

function storyTitle(content) {
  const words = content.trim().split(/\s+/u);
  return words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");
}

function renderStoryList() {
  storyList.replaceChildren();
  emptyLibrary.hidden = stories.length > 0;

  for (const story of stories) {
    const item = document.createElement("li");
    item.className = "story-list-item";

    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "story-title-button";
    titleButton.textContent = storyTitle(story.content);
    titleButton.addEventListener("click", () => openStory(story));
    item.append(titleButton);

    if (story.created_at) {
      const date = document.createElement("time");
      date.className = "story-date";
      date.dateTime = story.created_at;
      const parsedDate = new Date(story.created_at);
      date.textContent = Number.isNaN(parsedDate.getTime())
        ? story.created_at
        : parsedDate.toLocaleDateString();
      item.append(date);
    }

    storyList.append(item);
  }
}

async function loadStories() {
  try {
    stories = await getStories();
    renderStoryList();
    setStatus("");
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudieron cargar las historias.", true);
    return false;
  }
}

function stripWordPunctuation(value) {
  return value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

async function lookupWord(wordElement) {
  const word = stripWordPunctuation(wordElement.textContent);
  if (!word) {
    return;
  }

  currentDictionaryLine = wordElement.closest(".reader-line");
  currentDictionaryWord = word;
  wordLookupController?.abort();
  const controller = new AbortController();
  wordLookupController = controller;
  saveDictionaryFlashcardButton.disabled = !currentDictionaryLine;
  saveDictionaryFlashcardButton.textContent = "Guardar para estudiar";
  modalWord.textContent = word;
  modalTranslation.textContent = "Buscando traducción…";
  dictionaryModal.hidden = false;
  closeDictionaryModalButton.focus();

  try {
    const translation = await translateText(word, controller.signal);
    if (!controller.signal.aborted) {
      modalTranslation.textContent = translation;
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      modalTranslation.textContent = error instanceof Error
        ? error.message
        : "No se pudo consultar la palabra.";
    }
  }
}

async function saveDictionaryFlashcard() {
  if (!currentDictionaryLine || !currentDictionaryWord) {
    setStatus("No se encontró la palabra o su línea de contexto.", true);
    return;
  }

  saveDictionaryFlashcardButton.disabled = true;
  saveDictionaryFlashcardButton.textContent = "Creando flashcard…";
  modalTranslation.textContent = "Gemini está preparando una frase corta y su traducción…";
  try {
    const result = await postFlashcardApi(
      currentDictionaryWord,
      currentDictionaryLine.dataset.frenchText,
    );
    if (
      typeof result?.frase_francesa !== "string"
      || !result.frase_francesa.trim()
      || typeof result?.traduccion_espanola !== "string"
      || !result.traduccion_espanola.trim()
    ) {
      throw new Error("El servidor devolvió una flashcard inválida.");
    }

    await saveFlashcard(result.frase_francesa, result.traduccion_espanola);
    closeDictionaryModal();
    setStatus("Frase guardada para estudiar.");
  } catch (error) {
    saveDictionaryFlashcardButton.disabled = false;
    saveDictionaryFlashcardButton.textContent = "Guardar para estudiar";
    const message = error instanceof Error ? error.message : "No se pudo guardar la flashcard.";
    modalTranslation.textContent = message;
    setStatus(message, true);
  }
}

function createWordElement(value) {
  const word = document.createElement("span");
  word.className = "word story-word";
  word.textContent = value;
  word.tabIndex = 0;
  word.setAttribute("role", "button");
  word.setAttribute("aria-label", `Consultar la palabra ${value}`);
  word.addEventListener("click", () => lookupWord(word));
  word.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      lookupWord(word);
    }
  });
  return word;
}

function renderFrenchLine(paragraph, text, wordElements) {
  for (const part of text.split(/(\s+)/u)) {
    if (/^\s+$/u.test(part)) {
      paragraph.append(document.createTextNode(part));
    } else {
      const wordSpan = createWordElement(part);
      wordElements.push(wordSpan);
      paragraph.append(wordSpan);
    }
  }
}

async function translateReaderLines(signal) {
  const lines = Array.from(readerLines.querySelectorAll(".reader-line"));
  let hasErrors = false;
  translateButton.disabled = true;
  setStatus("Traduciendo líneas…");
  for (const [index, line] of lines.entries()) {
    if (signal.aborted) {
      break;
    }

    const frenchText = line.dataset.frenchText;
    const translation = line.querySelector(".line-translation");
    try {
      translation.textContent = await translateText(frenchText, signal);
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      hasErrors = true;
      translation.textContent = "No se pudo cargar la traducción.";
      setStatus(error instanceof Error ? error.message : "Falló una traducción.", true);
    }

    if (!signal.aborted && index < lines.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (translationController?.signal === signal) {
    translateButton.disabled = false;
  }
  if (signal.aborted) {
    return;
  }
  if (audioPlayer.paused) {
    setStatus(
      hasErrors
        ? "La lectura está lista, pero algunas traducciones no se pudieron cargar."
        : "Lectura y traducciones listas.",
      hasErrors,
    );
  }
}

function stopCurrentAudio() {
  audioPlayer.pause();
  stopKaraoke();
  stopKaraoke = () => {};
  currentAudioText = null;
  currentAudioBase64 = null;
  currentWordBoundaries = [];
  window.wordBoundaries = currentWordBoundaries;
  wordElements = [];
  playButton.setAttribute("aria-label", "Reproducir");
  playButton.setAttribute("aria-pressed", "false");
  playButton.querySelector("span").textContent = "▶";
}

function openStory(story) {
  translationController?.abort();
  wordLookupController?.abort();
  translateButton.disabled = false;
  closeDictionaryModal();
  stopCurrentAudio();
  currentStoryText = story.content.trim();
  readerTitle.textContent = storyTitle(story.content);
  readerLines.replaceChildren();
  wordElements = [];

  const paragraphs = currentStoryText
    .split(/\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const text of paragraphs) {
    const line = document.createElement("section");
    line.className = "reader-line";
    line.dataset.frenchText = text;

    const french = document.createElement("p");
    french.className = "line-french";
    renderFrenchLine(french, text, wordElements);

    const translation = document.createElement("p");
    translation.className = "line-translation";
    translation.textContent = "Pulsa «Traducir» para ver la traducción.";
    translation.setAttribute("aria-live", "polite");

    line.append(french, translation);
    readerLines.append(line);
  }

  translationController = new AbortController();
  showScreen("reader");
  setStatus("");
}

function stopFlashcardAudio() {
  if (!flashcardAudioUrl) {
    return;
  }

  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  URL.revokeObjectURL(flashcardAudioUrl);
  flashcardAudioUrl = null;
}

function renderCurrentFlashcard() {
  const flashcard = flashcards[currentFlashcardIndex];
  flashcardsEmpty.hidden = Boolean(flashcard);
  flashcardPanel.hidden = !flashcard;
  flashcardCount.textContent = flashcard
    ? `Frase ${currentFlashcardIndex + 1} de ${flashcards.length}`
    : "";
  flashcardFrench.textContent = flashcard?.frase_francesa ?? "";
  flashcardAnswer.value = "";
  flashcardFeedback.textContent = "";
}

async function openFlashcards() {
  translationController?.abort();
  closeDictionaryModal();
  stopCurrentAudio();
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  stopFlashcardAudio();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  showScreen("flashcards");
  flashcards = [];
  currentFlashcardIndex = 0;
  renderCurrentFlashcard();
  setStatus("Cargando flashcards…");

  try {
    flashcards = await getFlashcards();
    renderCurrentFlashcard();
    setStatus(flashcards.length ? "" : "Guarda frases traducidas desde la biblioteca para estudiar.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudieron cargar las flashcards.", true);
  }
}

async function playFlashcardAudio() {
  const flashcard = flashcards[currentFlashcardIndex];
  if (!flashcard) {
    return;
  }

  flashcardAudioButton.disabled = true;
  setStatus("Preparando audio…");
  try {
    const result = await postApi("/api/audio", flashcard.frase_francesa);
    if (typeof result?.audio_base64 !== "string") {
      throw new Error("El servidor no devolvió audio válido.");
    }

    stopFlashcardAudio();
    const binary = atob(result.audio_base64);
    const audioBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    flashcardAudioUrl = URL.createObjectURL(
      new Blob([audioBytes], { type: "audio/mpeg" }),
    );
    audioPlayer.src = flashcardAudioUrl;
    await audioPlayer.play();
    setStatus("");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudo reproducir la frase.", true);
  } finally {
    flashcardAudioButton.disabled = false;
  }
}

function closeDictionaryModal() {
  wordLookupController?.abort();
  dictionaryModal.hidden = true;
  currentDictionaryLine = null;
  currentDictionaryWord = "";
}

function setPlayingState(isPlaying) {
  playButton.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  playButton.setAttribute("aria-pressed", String(isPlaying));
  playButton.querySelector("span").textContent = isPlaying ? "Ⅱ" : "▶";
}

async function playStory() {
  if (!audioPlayer.paused) {
    audioPlayer.pause();
    setStatus("Reproducción pausada.");
    return;
  }
  if (!currentStoryText) {
    return;
  }

  playButton.disabled = true;
  setStatus(currentAudioText === currentStoryText ? "Reanudando audio…" : "Generando audio…");

  try {
    if (currentAudioUrl && currentAudioText === currentStoryText && !audioPlayer.ended) {
      audioPlayer.playbackRate = Number(speedSelect.value);
    } else {
      const result = await postApi("/api/audio", currentStoryText);
      console.log("Datos recibidos del backend:", result);
      window.wordBoundaries = result?.word_boundaries;
      console.log("Tiempos recibidos:", result?.word_boundaries);
      if (
        typeof result?.audio_base64 !== "string"
        || !Array.isArray(result?.word_boundaries)
        || !result.word_boundaries.every((boundary) => (
          typeof boundary?.text === "string"
          && Number.isFinite(boundary.start)
        ))
      ) {
        throw new Error("El servidor devolvió una respuesta de audio inválida.");
      }

      const binary = atob(result.audio_base64);
      const audioBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
      stopKaraoke();
      stopKaraoke = () => {};
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      currentAudioUrl = URL.createObjectURL(audioBlob);
      currentAudioText = currentStoryText;
      currentAudioBase64 = result.audio_base64;
      currentWordBoundaries = result.word_boundaries;
      audioPlayer.src = currentAudioUrl;
      audioPlayer.currentTime = 0;
      audioPlayer.playbackRate = Number(speedSelect.value);
      stopKaraoke = startKaraoke(wordElements);
    }

    console.log("Audio a punto de sonar");
    await audioPlayer.play();
    setPlayingState(true);
    setStatus("Reproduciendo historia…");
  } catch (error) {
    setPlayingState(false);
    setStatus(error instanceof Error ? error.message : "No se pudo reproducir el audio.", true);
  } finally {
    playButton.disabled = false;
  }
}

openLibraryButton.addEventListener("click", () => {
  stopFlashcardAudio();
  showScreen("library");
  void loadStories();
});
openFlashcardsButton.addEventListener("click", () => {
  void openFlashcards();
});
backHomeFromLibraryButton.addEventListener("click", () => {
  stopFlashcardAudio();
  showScreen("home");
  setStatus("");
});
backHomeFromFlashcardsButton.addEventListener("click", () => {
  stopFlashcardAudio();
  showScreen("home");
  setStatus("");
});
addTextButton.addEventListener("click", () => {
  showScreen("add");
  storyText.focus();
});

backToLibraryButton.addEventListener("click", () => {
  translationController?.abort();
  wordLookupController?.abort();
  closeDictionaryModal();
  stopCurrentAudio();
  stopFlashcardAudio();
  showScreen("library");
  void loadStories();
  setStatus("");
});

cancelAddButton.addEventListener("click", () => {
  showScreen("library");
  setStatus("");
});

storyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = storyText.value.trim();
  if (!content) {
    setStatus("Pega un texto antes de guardarlo.", true);
    storyText.focus();
    return;
  }

  saveButton.disabled = true;
  setStatus("Guardando texto…");
  try {
    await saveStory(content);
    storyText.value = "";
    showScreen("library");
    const refreshed = await loadStories();
    if (refreshed) {
      setStatus("Texto guardado.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudo guardar el texto.", true);
  } finally {
    saveButton.disabled = false;
  }
});

playButton.addEventListener("click", playStory);
flashcardAudioButton.addEventListener("click", playFlashcardAudio);
flashcardAnswerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!flashcardAnswer.value.trim()) {
    flashcardFeedback.textContent = "Escribe tu respuesta en español.";
    flashcardAnswer.focus();
    return;
  }
  flashcardFeedback.textContent = "La validación de respuestas estará disponible próximamente.";
});
saveDictionaryFlashcardButton.addEventListener("click", () => {
  void saveDictionaryFlashcard();
});
translateButton.addEventListener("click", () => {
  translationController?.abort();
  translationController = new AbortController();
  void translateReaderLines(translationController.signal);
});
speedSelect.addEventListener("change", () => {
  audioPlayer.playbackRate = Number(speedSelect.value);
});

closeDictionaryModalButton.addEventListener("click", closeDictionaryModal);
dictionaryModal.addEventListener("click", (event) => {
  if (event.target === dictionaryModal) {
    closeDictionaryModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dictionaryModal.hidden) {
    closeDictionaryModal();
  }
});

audioPlayer.addEventListener("pause", () => {
  if (!audioPlayer.ended) {
    setPlayingState(false);
  }
});

audioPlayer.addEventListener("ended", () => {
  stopKaraoke();
  setPlayingState(false);
  setStatus("Reproducción finalizada.");
});

document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  translationController?.abort();
  closeDictionaryModal();
  stopCurrentAudio();
  stopFlashcardAudio();
  showScreen("home");
  setStatus("");
});

showScreen("home");
setStatus("");
