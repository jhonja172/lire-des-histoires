import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const TABLE_URL = `${SUPABASE_URL.replace(/\/$/u, "")}/rest/v1/flashcards`;

function getHeaders(prefer) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Configura SUPABASE_URL y SUPABASE_ANON_KEY en frontend/js/supabase-config.js.",
    );
  }

  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function readError(response) {
  const body = await response.text();
  if (!body) {
    return `Supabase respondió con el error ${response.status}.`;
  }

  try {
    const details = JSON.parse(body);
    return details.message ?? details.error_description ?? body;
  } catch {
    return body;
  }
}

export async function saveFlashcard(french, spanish) {
  const response = await fetch(TABLE_URL, {
    method: "POST",
    headers: getHeaders("return=minimal"),
    body: JSON.stringify({
      frase_francesa: french,
      traduccion_espanola: spanish,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function getFlashcards() {
  const query = new URLSearchParams({
    select: "id,frase_francesa,traduccion_espanola,created_at",
    order: "created_at.desc",
  });
  const response = await fetch(`${TABLE_URL}?${query}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const flashcards = await response.json();
  if (!Array.isArray(flashcards)) {
    throw new Error("Supabase devolvió una lista de flashcards inválida.");
  }
  return flashcards;
}
