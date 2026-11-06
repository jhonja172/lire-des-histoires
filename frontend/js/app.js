import { saveStory } from "./storage.js";

const form = document.querySelector("#story-form");
const textInput = document.querySelector("#story-text");
const storyOutput = document.querySelector("#story-output");
const statusMessage = document.querySelector("#status-message");

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
    await saveStory(text);
    renderStory(text);
    statusMessage.textContent = "Historia guardada en este dispositivo.";
  } catch (error) {
    statusMessage.dataset.state = "error";
    statusMessage.textContent = error instanceof Error
      ? error.message
      : "No se pudo guardar la historia.";
  }
});
