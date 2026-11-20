import { getStories, saveStory } from "./storage.js";
import { startKaraoke } from "./karaoke.js";
import {
  deleteFlashcard,
  getFlashcards,
  saveFlashcard,
} from "./supabase.js";

const API_URL = "https://lire-des-histoires.onrender.com";
const homeScreen = document.querySelector("#home-screen");
const libraryScreen = document.querySelector("#library-screen");
const readerScreen = document.querySelector("#reader-screen");
const addScreen = document.querySelector("#add-screen");
const flashcardsScreen = document.querySelector("#flashcards-screen");
const quizScreen = document.querySelector("#quiz-screen");
const storyList = document.querySelector("#story-list");
const emptyLibrary = document.querySelector("#empty-library");
const statusMessage = document.querySelector("#status-message");
const openLibraryButton = document.querySelector("#open-library-button");
const openFlashcardsButton = document.querySelector("#open-flashcards-button");
const openQuizButton = document.querySelector("#open-quiz-button");
const addTextButton = document.querySelector("#add-text-button");
const backHomeFromLibraryButton = document.querySelector("#back-home-from-library");
const backHomeFromFlashcardsButton = document.querySelector("#back-home-from-flashcards");
const backHomeFromQuizButton = document.querySelector("#back-home-from-quiz");
const backHomeFromQuizCompleteButton = document.querySelector("#back-home-from-quiz-complete");
const quizLoading = document.querySelector("#quiz-loading");
const quizLoadingMessage = document.querySelector("#quiz-loading-message");
const quizStoryPicker = document.querySelector("#quiz-story-picker");
const quizStorySelect = document.querySelector("#quiz-story-select");
const startQuizButton = document.querySelector("#start-quiz-button");
const quizQuestionProgress = document.querySelector("#quiz-question-progress");
const quizQuestionCard = document.querySelector("#quiz-question-card");
const quizQuestionNumber = document.querySelector("#quiz-question-number");
const quizQuestionText = document.querySelector("#quiz-question-text");
const quizOptions = document.querySelector("#quiz-options");
const quizAnswerFeedback = document.querySelector("#quiz-answer-feedback");
const quizExplanation = document.querySelector("#quiz-explanation");
const quizNextButton = document.querySelector("#quiz-next-button");
const quizCompletion = document.querySelector("#quiz-completion");
const quizScore = document.querySelector("#quiz-score");
const backToLibraryButton = document.querySelector("#back-to-library");
const quizFromReaderButton = document.querySelector("#quiz-from-reader-button");
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
const deleteFlashcardButton = document.querySelector("#delete-flashcard-button");
const flashcardAudioButton = document.querySelector("#flashcard-audio-button");
const flashcardAnswerForm = document.querySelector("#flashcard-answer-form");
const flashcardAnswerLabel = document.querySelector('label[for="flashcard-answer"]');
const flashcardSubmitButton = document.querySelector("#flashcard-submit-button");
const flashcardAnswer = document.querySelector("#flashcard-answer");
const showAnswerButton = document.querySelector("#show-answer-btn");
const answerContainer = document.querySelector("#answer-container");
const flashcardRatingButtons = document.querySelector("#flashcard-rating-buttons");
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
let quizRequestController = null;
let quizFlowId = 0;
let quizQuestions = [];
let currentQuestionIndex = 0;
let selectedAnswer = null;
let quizCorrectCount = 0;
let quizContextSaved = false;

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

async function postAudio(text) {
  const response = await fetch(`${API_URL}/api/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const audioBlob = await response.blob();
  if (!audioBlob.size || !audioBlob.type.startsWith("audio/")) {
    throw new Error("El servidor no devolvió un archivo de audio válido.");
  }
  return audioBlob;
}

function loadAudioMetadata(audio, source) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("No se pudieron leer los datos del archivo de audio."));
    };

    audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.src = source;
    audio.load();
  });
}

function estimateWordBoundaries(text, duration) {
  const words = text.match(/\S+/gu) ?? [];
  const totalCharacters = words.reduce((total, word) => total + word.length, 0);
  if (!words.length || !totalCharacters || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("No se pudo calcular la sincronización de las palabras.");
  }

  let elapsed = 0;
  return words.map((word) => {
    const start = elapsed;
    const wordDuration = duration * (word.length / totalCharacters);
    elapsed += wordDuration;
    return { text: word, start, duration: wordDuration };
  });
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

async function postFlashcardValidation(userAnswer, correctAnswer, originalText) {
  const response = await fetch(`${API_URL}/api/validate_flashcard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_answer: userAnswer,
      correct_answer: correctAnswer,
      original_text: originalText,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return response.json();
}

async function postFlashcardSchedule(flashcardId, rating) {
  const response = await fetch(`${API_URL}/api/schedule_flashcard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flashcard_id: flashcardId, rating }),
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
  quizScreen.hidden = screenName !== "quiz";
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

    const quizButton = document.createElement("button");
    quizButton.type = "button";
    quizButton.className = "primary-button story-quiz-button";
    quizButton.textContent = "Hacer Quiz";
    quizButton.setAttribute("aria-label", `Hacer Quiz: ${storyTitle(story.content)}`);
    quizButton.addEventListener("click", () => {
      currentStoryText = story.content.trim();
      void openQuiz();
    });
    item.append(quizButton);

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

function validateQuizQuestions(result) {
  const questions = Array.isArray(result) ? result : result?.preguntas;
  if (!Array.isArray(questions) || questions.length !== 5) {
    throw new Error("El servidor no devolvió exactamente 5 preguntas.");
  }

  return questions.map((question) => {
    if (
      typeof question?.pregunta !== "string"
      || !question.pregunta.trim()
      || !Array.isArray(question.opciones)
      || question.opciones.length !== 4
      || question.opciones.some((option) => typeof option !== "string" || !option.trim())
      || typeof question.respuesta_correcta !== "string"
      || !question.opciones.some((option) => option.trim() === question.respuesta_correcta.trim())
      || typeof question.explicacion !== "string"
      || !question.explicacion.trim()
      || typeof question.oracion_contexto !== "string"
      || !question.oracion_contexto.trim()
      || typeof question.traduccion_contexto !== "string"
      || !question.traduccion_contexto.trim()
    ) {
      throw new Error("El servidor devolvió una pregunta con formato inválido.");
    }

    return {
      pregunta: question.pregunta.trim(),
      opciones: question.opciones.map((option) => option.trim()),
      respuesta_correcta: question.respuesta_correcta.trim(),
      explicacion: question.explicacion.trim(),
      oracion_contexto: question.oracion_contexto.trim(),
      traduccion_contexto: question.traduccion_contexto.trim(),
    };
  });
}

async function saveQuizContextFlashcard(question) {
  const response = await fetch(`${API_URL}/api/save_flashcard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frase_francesa: question.oracion_contexto,
      traduccion_espanola: question.traduccion_contexto,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const result = await response.json();
  if (
    typeof result?.flashcard?.frase_francesa !== "string"
    || typeof result.flashcard.traduccion_espanola !== "string"
  ) {
    throw new Error("El servidor no confirmó el guardado de la flashcard.");
  }
}

function renderQuizQuestions(questions) {
  quizQuestions = questions;
  currentQuestionIndex = 0;
  selectedAnswer = null;
  quizCorrectCount = 0;
  quizContextSaved = false;
  renderCurrentQuizQuestion();
}

function renderCurrentQuizQuestion() {
  const question = quizQuestions[currentQuestionIndex];
  if (!question) {
    quizQuestionCard.hidden = true;
    quizQuestionProgress.hidden = true;
    quizScore.textContent = `Has acertado ${quizCorrectCount} de ${quizQuestions.length} preguntas.`;
    quizCompletion.hidden = false;
    return;
  }

  quizCompletion.hidden = true;
  quizQuestionCard.hidden = false;
  quizQuestionProgress.hidden = false;
  quizQuestionProgress.textContent = `Pregunta ${currentQuestionIndex + 1} de ${quizQuestions.length}`;
  quizQuestionNumber.textContent = `Pregunta ${currentQuestionIndex + 1}`;
  quizQuestionText.textContent = question.pregunta;
  quizAnswerFeedback.textContent = "";
  quizExplanation.textContent = "";
  quizExplanation.hidden = true;
  quizNextButton.disabled = true;
  quizContextSaved = false;
  quizNextButton.textContent = currentQuestionIndex === quizQuestions.length - 1
    ? "Ver resultados"
    : "Siguiente";
  quizOptions.replaceChildren();

  for (const option of question.opciones) {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "quiz-option";
    optionButton.textContent = option;
    optionButton.addEventListener("click", () => {
      if (selectedAnswer !== null) {
        return;
      }

      selectedAnswer = option;
      const isCorrect = option === question.respuesta_correcta;
      if (isCorrect) {
        quizCorrectCount += 1;
      }

      for (const button of quizOptions.querySelectorAll(".quiz-option")) {
        button.disabled = true;
        if (button.textContent === question.respuesta_correcta) {
          button.classList.add("quiz-option-correct");
        }
      }
      if (!isCorrect) {
        optionButton.classList.add("quiz-option-incorrect");
        quizAnswerFeedback.textContent = `Incorrecto. Respuesta correcta: ${question.respuesta_correcta}`;
        quizExplanation.textContent = question.explicacion;
        quizExplanation.hidden = false;
      } else {
        quizAnswerFeedback.textContent = "¡Bien joué ! ¡Bien hecho!";
      }

      quizNextButton.disabled = false;
    });
    quizOptions.append(optionButton);
  }
}

async function showNextQuizQuestion() {
  if (selectedAnswer === null || quizNextButton.disabled) {
    return;
  }

  const question = quizQuestions[currentQuestionIndex];
  if (selectedAnswer !== question.respuesta_correcta && !quizContextSaved) {
    quizNextButton.disabled = true;
    quizNextButton.textContent = "Guardando...";
    try {
      await saveQuizContextFlashcard(question);
      quizContextSaved = true;
      setStatus("Flashcard de contexto guardada.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "No se pudo guardar la flashcard de contexto.",
        true,
      );
      quizNextButton.disabled = false;
      quizNextButton.textContent = "Reintentar guardado";
      return;
    }
  }

  currentQuestionIndex += 1;
  selectedAnswer = null;
  renderCurrentQuizQuestion();
}

async function startQuiz(text) {
  quizRequestController?.abort();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 120000);
  quizRequestController = controller;
  quizStoryPicker.hidden = true;
  quizQuestionCard.hidden = true;
  quizQuestionProgress.hidden = true;
  quizCompletion.hidden = true;
  quizOptions.replaceChildren();
  quizLoadingMessage.textContent = "Generando preguntas...";
  quizLoading.hidden = false;
  setStatus("");

  try {
    const response = await fetch(`${API_URL}/api/generar_preguntas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const questions = validateQuizQuestions(await response.json());
    if (controller.signal.aborted) {
      return;
    }
    renderQuizQuestions(questions);
  } catch (error) {
    if (controller.signal.aborted && !timedOut) {
      return;
    }
    const message = timedOut
      ? "La generación tardó más de 2 minutos y se canceló."
      : error instanceof Error
        ? error.message
        : "No se pudieron cargar las preguntas.";
    setStatus(message, true);
  } finally {
    clearTimeout(timeoutId);
    if (quizRequestController === controller) {
      quizRequestController = null;
      quizLoading.hidden = true;
    }
  }
}

async function openQuiz() {
  const flowId = ++quizFlowId;
  stopFlashcardAudio();
  quizRequestController?.abort();
  showScreen("quiz");
  quizLoading.hidden = true;
  quizStoryPicker.hidden = true;
  quizQuestionCard.hidden = true;
  quizQuestionProgress.hidden = true;
  quizCompletion.hidden = true;
  quizOptions.replaceChildren();
  setStatus("");

  if (currentStoryText) {
    await startQuiz(currentStoryText);
    return;
  }

  quizLoadingMessage.textContent = "Cargando historias…";
  quizLoading.hidden = false;
  try {
    stories = await getStories();
    if (flowId !== quizFlowId) {
      return;
    }

    if (!stories.length) {
      setStatus("Agrega una historia en la biblioteca antes de empezar un quiz.", true);
      return;
    }

    if (stories.length === 1) {
      currentStoryText = stories[0].content.trim();
      await startQuiz(currentStoryText);
      return;
    }

    quizStorySelect.replaceChildren();
    for (const story of stories) {
      const option = document.createElement("option");
      option.value = String(story.id);
      option.textContent = storyTitle(story.content);
      quizStorySelect.append(option);
    }
    quizStoryPicker.hidden = false;
  } catch (error) {
    if (flowId === quizFlowId) {
      setStatus(error instanceof Error ? error.message : "No se pudieron cargar tus historias.", true);
    }
  } finally {
    if (flowId === quizFlowId) {
      quizLoading.hidden = true;
    }
  }
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
  deleteFlashcardButton.disabled = false;
  flashcardAudioButton.disabled = false;
  flashcardsEmpty.hidden = Boolean(flashcard);
  flashcardPanel.hidden = !flashcard;
  flashcardCount.textContent = flashcard
    ? `Frase ${currentFlashcardIndex + 1} de ${flashcards.length}`
    : "";
  flashcardFrench.textContent = flashcard?.frase_francesa ?? "";
  flashcardAnswer.value = "";
  flashcardAnswer.disabled = false;
  flashcardAnswerLabel.hidden = false;
  flashcardSubmitButton.disabled = false;
  flashcardSubmitButton.textContent = "Enviar respuesta";
  flashcardSubmitButton.hidden = false;
  flashcardFeedback.textContent = "";
  flashcardFeedback.removeAttribute("data-state");
  answerContainer.textContent = flashcard?.traduccion_espanola ?? "";
  answerContainer.hidden = true;
  showAnswerButton.hidden = !flashcard;
  showAnswerButton.disabled = false;
  flashcardRatingButtons.hidden = true;
  for (const ratingButton of flashcardRatingButtons.querySelectorAll("button")) {
    ratingButton.disabled = false;
  }
}

async function removeCurrentFlashcard() {
  const flashcard = flashcards[currentFlashcardIndex];
  if (!flashcard) {
    return;
  }
  if (!window.confirm("¿Eliminar esta flashcard? Esta acción no se puede deshacer.")) {
    return;
  }

  deleteFlashcardButton.disabled = true;
  try {
    await deleteFlashcard(flashcard.id);
    flashcards.splice(currentFlashcardIndex, 1);
    currentFlashcardIndex = Math.min(currentFlashcardIndex, flashcards.length - 1);
    renderCurrentFlashcard();
    setStatus("Flashcard eliminada.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudo eliminar la flashcard.", true);
  } finally {
    deleteFlashcardButton.disabled = false;
  }
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
    const audioBlob = await postAudio(flashcard.frase_francesa);
    stopFlashcardAudio();
    flashcardAudioUrl = URL.createObjectURL(
      audioBlob,
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
      const audioBlob = await postAudio(currentStoryText);
      stopKaraoke();
      stopKaraoke = () => {};
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      currentAudioUrl = URL.createObjectURL(audioBlob);
      currentAudioText = currentStoryText;
      await loadAudioMetadata(audioPlayer, currentAudioUrl);
      currentWordBoundaries = estimateWordBoundaries(
        currentStoryText,
        audioPlayer.duration,
      );
      window.wordBoundaries = currentWordBoundaries;
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
openQuizButton.addEventListener("click", () => {
  void openQuiz();
});
quizFromReaderButton.addEventListener("click", () => {
  translationController?.abort();
  stopCurrentAudio();
  void openQuiz();
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
function returnHomeFromQuiz() {
  quizFlowId += 1;
  quizRequestController?.abort();
  quizRequestController = null;
  showScreen("home");
  setStatus("");
}
backHomeFromQuizButton.addEventListener("click", returnHomeFromQuiz);
backHomeFromQuizCompleteButton.addEventListener("click", returnHomeFromQuiz);
quizNextButton.addEventListener("click", showNextQuizQuestion);
startQuizButton.addEventListener("click", () => {
  const story = stories.find((item) => String(item.id) === quizStorySelect.value);
  if (!story) {
    setStatus("Selecciona una historia válida.", true);
    return;
  }

  currentStoryText = story.content.trim();
  void startQuiz(currentStoryText);
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
deleteFlashcardButton.addEventListener("click", () => {
  void removeCurrentFlashcard();
});
flashcardAnswerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const flashcard = flashcards[currentFlashcardIndex];
  const userAnswer = flashcardAnswer.value.trim();
  if (!flashcard) {
    flashcardFeedback.textContent = "No hay una flashcard seleccionada.";
    flashcardFeedback.dataset.state = "incorrect";
    return;
  }
  if (!userAnswer) {
    flashcardFeedback.textContent = "Escribe tu respuesta en español.";
    flashcardFeedback.dataset.state = "incorrect";
    flashcardAnswer.focus();
    return;
  }

  flashcardSubmitButton.disabled = true;
  flashcardSubmitButton.textContent = "Validando…";
  flashcardFeedback.textContent = "Gemini está revisando tu respuesta…";
  flashcardFeedback.removeAttribute("data-state");
  try {
    const result = await postFlashcardValidation(
      userAnswer,
      flashcard.traduccion_espanola,
      flashcard.frase_francesa,
    );
    if (typeof result?.is_correct !== "boolean" || typeof result?.feedback !== "string") {
      throw new Error("El servidor devolvió una validación inválida.");
    }

    flashcardFeedback.textContent = result.feedback;
    flashcardFeedback.dataset.state = result.is_correct ? "correct" : "incorrect";
    flashcardAnswer.disabled = true;
    flashcardAnswerLabel.hidden = true;
    flashcardSubmitButton.hidden = true;
    flashcardRatingButtons.hidden = false;
  } catch (error) {
    flashcardSubmitButton.disabled = false;
    flashcardSubmitButton.textContent = "Enviar respuesta";
    flashcardFeedback.textContent = error instanceof Error
      ? error.message
      : "No se pudo validar la respuesta.";
    flashcardFeedback.dataset.state = "incorrect";
  }
});

flashcardRatingButtons.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const rating = Number(target.dataset.rating);
  const flashcard = flashcards[currentFlashcardIndex];
  if (!flashcard || !Number.isInteger(rating) || rating < 1 || rating > 4) {
    return;
  }

  for (const ratingButton of flashcardRatingButtons.querySelectorAll("button")) {
    ratingButton.disabled = true;
  }
  deleteFlashcardButton.disabled = true;
  flashcardAudioButton.disabled = true;
  showAnswerButton.disabled = true;
  flashcardFeedback.textContent = "Guardando el próximo repaso…";
  flashcardFeedback.removeAttribute("data-state");
  try {
    const result = await postFlashcardSchedule(flashcard.id, rating);
    if (!Number.isInteger(result?.days_until_review) || result.days_until_review < 0) {
      throw new Error("El servidor devolvió un intervalo de repaso inválido.");
    }

    flashcardFeedback.textContent = result.days_until_review === 0
      ? "La tarjeta vuelve a estar lista para repasar hoy."
      : `Próximo repaso en ${result.days_until_review} día${result.days_until_review === 1 ? "" : "s"}.`;
    flashcardFeedback.dataset.state = "correct";

    if (result.days_until_review > 0) {
      flashcards.splice(currentFlashcardIndex, 1);
      if (currentFlashcardIndex >= flashcards.length) {
        currentFlashcardIndex = 0;
      }
    } else if (flashcards.length > 1) {
      currentFlashcardIndex = (currentFlashcardIndex + 1) % flashcards.length;
    }

    window.setTimeout(() => {
      renderCurrentFlashcard();
      setStatus("");
    }, 1100);
  } catch (error) {
    for (const ratingButton of flashcardRatingButtons.querySelectorAll("button")) {
      ratingButton.disabled = false;
    }
    deleteFlashcardButton.disabled = false;
    flashcardAudioButton.disabled = false;
    showAnswerButton.disabled = false;
    flashcardFeedback.textContent = error instanceof Error
      ? error.message
      : "No se pudo programar el repaso.";
    flashcardFeedback.dataset.state = "incorrect";
  }
});
showAnswerButton.addEventListener("click", () => {
  const flashcard = flashcards[currentFlashcardIndex];
  if (!flashcard) {
    return;
  }

  answerContainer.textContent = flashcard.traduccion_espanola;
  answerContainer.hidden = false;
  showAnswerButton.hidden = true;
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
