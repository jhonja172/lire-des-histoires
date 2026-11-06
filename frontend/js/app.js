import { getStories, saveStory } from "./storage.js";
import { startKaraoke } from "./karaoke.js";

const API_URL = "https://lire-des-histoires.onrender.com";
const libraryScreen = document.querySelector("#library-screen");
const readerScreen = document.querySelector("#reader-screen");
const addScreen = document.querySelector("#add-screen");
const storyList = document.querySelector("#story-list");
const emptyLibrary = document.querySelector("#empty-library");
const statusMessage = document.querySelector("#status-message");
const addTextButton = document.querySelector("#add-text-button");
const backToLibraryButton = document.querySelector("#back-to-library");
const cancelAddButton = document.querySelector("#cancel-add-button");
const storyForm = document.querySelector("#story-form");
const storyText = document.querySelector("#story-text");
const saveButton = document.querySelector("#save-button");
const readerTitle = document.querySelector("#reader-title");
const readerLines = document.querySelector("#reader-lines");
const dictionaryResult = document.querySelector("#dictionary-result");
const playButton = document.querySelector("#play-button");
const speedSelect = document.querySelector("#speed-select");
const audioPlayer = new Audio();

let stories = [];
let currentStoryText = "";
let currentAudioText = null;
let currentAudioUrl = null;
let currentWordBoundaries = [];
let stopKaraoke = () => {};
let translationController = null;
let wordLookupController = null;

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
  libraryScreen.hidden = screenName !== "library";
  readerScreen.hidden = screenName !== "reader";
  addScreen.hidden = screenName !== "add";
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

  wordLookupController?.abort();
  const controller = new AbortController();
  wordLookupController = controller;
  dictionaryResult.hidden = false;
  dictionaryResult.textContent = `Buscando «${word}»…`;

  try {
    const translation = await translateText(word, controller.signal);
    dictionaryResult.textContent = `${word} — ${translation}`;
  } catch (error) {
    if (!controller.signal.aborted) {
      dictionaryResult.textContent = error instanceof Error
        ? error.message
        : "No se pudo consultar la palabra.";
    }
  }
}

function createWordElement(value) {
  const word = document.createElement("span");
  word.className = "story-word";
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

function renderFrenchLine(paragraph, text) {
  for (const part of text.split(/(\s+)/u)) {
    if (/^\s+$/u.test(part)) {
      paragraph.append(document.createTextNode(part));
    } else {
      paragraph.append(createWordElement(part));
    }
  }
}

async function translateReaderLines(signal) {
  const lines = Array.from(readerLines.querySelectorAll(".reader-line"));
  let hasErrors = false;
  for (const line of lines) {
    if (signal.aborted) {
      return;
    }

    const frenchText = line.dataset.frenchText;
    const translation = line.querySelector(".line-translation");
    try {
      translation.textContent = await translateText(frenchText, signal);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      hasErrors = true;
      translation.textContent = "No se pudo cargar la traducción.";
      setStatus(error instanceof Error ? error.message : "Falló una traducción.", true);
    }
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
  currentAudioText = null;
  currentWordBoundaries = [];
  playButton.setAttribute("aria-label", "Reproducir");
  playButton.setAttribute("aria-pressed", "false");
  playButton.querySelector("span").textContent = "▶";
}

function openStory(story) {
  translationController?.abort();
  wordLookupController?.abort();
  stopCurrentAudio();
  currentStoryText = story.content.trim();
  readerTitle.textContent = storyTitle(story.content);
  readerLines.replaceChildren();
  dictionaryResult.hidden = true;
  dictionaryResult.textContent = "";

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
    renderFrenchLine(french, text);

    const translation = document.createElement("p");
    translation.className = "line-translation";
    translation.textContent = "Cargando traducción…";
    translation.setAttribute("aria-live", "polite");

    line.append(french, translation);
    readerLines.append(line);
  }

  translationController = new AbortController();
  showScreen("reader");
  setStatus("Cargando traducciones…");
  void translateReaderLines(translationController.signal);
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
      await audioPlayer.play();
    } else {
      const result = await postApi("/api/audio", currentStoryText);
      if (
        typeof result.audio_base64 !== "string"
        || !Array.isArray(result.word_boundaries)
        || !result.word_boundaries.every((boundary) => Number.isFinite(boundary?.start))
      ) {
        throw new Error("El servidor devolvió una respuesta de audio inválida.");
      }

      const binary = atob(result.audio_base64);
      const audioBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      currentAudioUrl = URL.createObjectURL(audioBlob);
      currentAudioText = currentStoryText;
      currentWordBoundaries = result.word_boundaries;
      audioPlayer.src = currentAudioUrl;
      audioPlayer.currentTime = 0;
      audioPlayer.playbackRate = Number(speedSelect.value);
      await audioPlayer.play();
    }

    stopKaraoke = startKaraoke(audioPlayer, currentWordBoundaries);
    setPlayingState(true);
    setStatus("Reproduciendo historia…");
  } catch (error) {
    setPlayingState(false);
    setStatus(error instanceof Error ? error.message : "No se pudo reproducir el audio.", true);
  } finally {
    playButton.disabled = false;
  }
}

addTextButton.addEventListener("click", () => {
  showScreen("add");
  storyText.focus();
});

backToLibraryButton.addEventListener("click", () => {
  translationController?.abort();
  wordLookupController?.abort();
  stopCurrentAudio();
  showScreen("library");
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
speedSelect.addEventListener("change", () => {
  audioPlayer.playbackRate = Number(speedSelect.value);
});

audioPlayer.addEventListener("pause", () => {
  stopKaraoke();
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
  stopCurrentAudio();
  showScreen("library");
  setStatus("");
});

setStatus("Cargando biblioteca…");
loadStories();
