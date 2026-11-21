const SUPABASE_URL = "https://qscskrbyyvkfutotrcgo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AYuVarEL1KRgbEr2rdpaxg_5-XdM7rY";
const STORIES_ENDPOINT = `${SUPABASE_URL}/rest/v1/stories`;
const API_URL = "https://lire-des-histoires.onrender.com";

async function readError(response) {
  const body = await response.text();
  if (!body) {
    return `Error del servidor (${response.status}).`;
  }

  try {
    const details = JSON.parse(body);
    return details?.detail
      ?? details?.message
      ?? details?.details
      ?? details?.hint
      ?? `Error del servidor (${response.status}).`;
  } catch {
    return body;
  }
}

export async function saveStory(content, nivel) {
  const response = await fetch(`${API_URL}/api/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, nivel }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const result = await response.json();
  if (!result?.story || typeof result.story.content !== "string") {
    throw new Error("El servidor no confirmó el guardado de la historia.");
  }
  return result.story;
}

export async function deleteStory(id) {
  const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function getStories() {
  const query = new URLSearchParams({
    select: "id,created_at,content,nivel",
    order: "created_at.desc",
  });
  const response = await fetch(`${STORIES_ENDPOINT}?${query}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const stories = await response.json();
  if (!Array.isArray(stories)) {
    throw new Error("Supabase devolvió una lista de historias inválida.");
  }
  return stories;
}
