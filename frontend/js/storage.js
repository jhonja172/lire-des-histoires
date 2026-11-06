const SUPABASE_URL = "https://qscskrbyyvkfutotrcgo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AYuVarEL1KRgbEr2rdpaxg_5-XdM7rY";
const STORIES_ENDPOINT = `${SUPABASE_URL}/rest/v1/stories`;

async function readError(response) {
  const body = await response.text();
  if (!body) {
    return `Error de Supabase (${response.status}).`;
  }

  try {
    const details = JSON.parse(body);
    return details?.message
      ?? details?.details
      ?? details?.hint
      ?? `Error de Supabase (${response.status}).`;
  } catch {
    return body;
  }
}

export async function saveStory(content) {
  const response = await fetch(STORIES_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const [story] = await response.json();
  if (!story || typeof story.content !== "string") {
    throw new Error("Supabase no devolvió la historia guardada.");
  }
  return story;
}

export async function getStories() {
  const query = new URLSearchParams({
    select: "id,created_at,content",
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
