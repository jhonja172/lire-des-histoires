import { getStories, saveStory } from "./storage.js";
import { startKaraoke } from "./karaoke.js";

const API_URL = "PENDIENTE";
const form = document.querySelector("#story-form");
const textInput = document.querySelector("#story-text");
const storyOutput = document.querySelector("#story-output");
const statusMessage = document.querySelector("#status-message");
const playButton = document.querySelector("#play-button");
const audioPlayer = new Audio();
const storyHistory = document.createElement("section");
storyHistory.className = "story-history";
storyHistory.setAttribute("aria-labelledby", "story-history-title");
storyHistory.innerHTML = '<h2 id="story-history-title">Historias guardadas</h2><ul></ul>';
document.querySelector(".saved-story").append(storyHistory);
const storyHistoryList = storyHistory.querySelector("ul");
let stopKaraoke = () => {};
let currentAudioUrl = null;
let currentAudioText = null;
let currentWordBoundaries = [];
let stories = [];

function renderStory(text) {
  storyOutput.replaceChildren();

  const parts = text.split(/(\s+)/u);
  for (const part of parts) {
    if (/^\s+$/u.test(part)) {
      storyOutput.append(document.createTextNode(part));
      continue;
    }

    const word = document.createElement("span");
    word.className = "story-word";
    word.textContent = part;
    storyOutput.append(word);
  }
}

function renderStoryHistory() {
  storyHistoryList.replaceChildren();

  for (const story of stories) {
    const item = document.createElement("li");
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "history-story-button";
    selectButton.textContent = story.content;
    selectButton.addEventListener("click", () => {
      textInput.value = story.content;
      renderStory(story.content);
      statusMessage.removeAttribute("data-state");
      statusMessage.textContent = "Historia cargada.";
    });

    item.append(selectButton);
    if (story.created_at) {
      const savedDate = document.createElement("time");
      savedDate.dateTime = story.created_at;
      savedDate.textContent = new Date(story.created_at).toLocaleString();
      item.append(savedDate);
    }
    storyHistoryList.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = textInput.value.trim();
  if (!text) {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = "Escribe o pega una historia antes de guardarla.";
    textInput.focus();
    return;
  }

  statusMessage.removeAttribute("data-state");
  statusMessage.textContent = "Guardando…";

  try {
    const savedStory = await saveStory(text);
    stories = [savedStory, ...stories];
    renderStoryHistory();
    textInput.value = savedStory.content;
    renderStory(savedStory.content);
    statusMessage.textContent = "Historia guardada en Supabase.";
  } catch (error) {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = error instanceof Error
      ? error.message
      : "No se pudo guardar la historia.";
  }
});

async function loadStories() {
  statusMessage.textContent = "Cargando historias…";

  try {
    stories = await getStories();
    renderStoryHistory();

    if (stories.length > 0) {
      textInput.value = stories[0].content;
      renderStory(stories[0].content);
      statusMessage.textContent = "Historias cargadas.";
    } else {
      statusMessage.textContent = "Aún no hay historias guardadas.";
    }
  } catch (error) {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = error instanceof Error
      ? error.message
      : "No se pudieron cargar las historias.";
  }
}

loadStories();

playButton.addEventListener("click", async () => {
  if (!audioPlayer.paused) {
    audioPlayer.pause();
    stopKaraoke();
    playButton.textContent = "Continuar";
    statusMessage.textContent = "Reproducción pausada.";
    return;
  }

  const text = textInput.value.trim();
  if (!text) {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = "Escribe o pega una historia antes de reproducirla.";
    textInput.focus();
    return;
  }

  renderStory(text);

  if (
    currentAudioUrl
    && currentAudioText === text
    && audioPlayer.currentTime > 0
    && !audioPlayer.ended
  ) {
    try {
      await audioPlayer.play();
      stopKaraoke = startKaraoke(audioPlayer, currentWordBoundaries);
      playButton.textContent = "Pausar";
      statusMessage.textContent = "Reproduciendo historia…";
    } catch (error) {
      statusMessage.dataset.state = "error";
      statusMessage.textContent = error instanceof Error
        ? error.message
        : "No se pudo reanudar el audio.";
    }
    return;
  }

  if (API_URL === "PENDIENTE") {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = "Configura API_URL con la URL de tu backend en Render.";
    return;
  }

  playButton.disabled = true;
  statusMessage.removeAttribute("data-state");
  statusMessage.textContent = "Generando audio…";

  try {
    const response = await fetch(`${API_URL.replace(/\/$/u, "")}/api/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.detail ?? `Error del servidor (${response.status}).`);
    }

    const result = await response.json();
    if (typeof result.audio_base64 !== "string" || !Array.isArray(result.word_boundaries)) {
      throw new Error("El servidor devolvió una respuesta de audio inválida.");
    }

    const binary = atob(result.audio_base64);
    const audioBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
    }
    currentAudioUrl = URL.createObjectURL(audioBlob);
    currentAudioText = text;
    audioPlayer.src = currentAudioUrl;
    audioPlayer.currentTime = 0;
    currentWordBoundaries = result.word_boundaries;

    await audioPlayer.play();
    stopKaraoke = startKaraoke(audioPlayer, currentWordBoundaries);
    playButton.textContent = "Pausar";
    statusMessage.textContent = "Reproduciendo historia…";
  } catch (error) {
    stopKaraoke();
    playButton.disabled = false;
    playButton.textContent = "Reproducir";
    statusMessage.dataset.state = "error";
    statusMessage.textContent = error instanceof Error
      ? error.message
      : "No se pudo reproducir el audio.";
    return;
  }

  playButton.disabled = false;
});

audioPlayer.addEventListener("ended", () => {
  stopKaraoke();
  playButton.textContent = "Reproducir";
  currentWordBoundaries = [];
  statusMessage.textContent = "Reproducción finalizada.";
});

audioPlayer.addEventListener("pause", () => {
  stopKaraoke();
});
