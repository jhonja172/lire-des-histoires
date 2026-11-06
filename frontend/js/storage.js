const DATABASE_NAME = "lire-des-histoires";
const DATABASE_VERSION = 1;
const STORY_STORE = "stories";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Este navegador no permite guardar historias localmente."));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORY_STORE)) {
        database.createObjectStore(STORY_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("No se pudo abrir el almacenamiento de historias.")
    );
    request.onblocked = () => reject(
      new Error("El almacenamiento está ocupado por otra pestaña. Cierra las demás e inténtalo de nuevo.")
    );
  });
}

export async function saveStory(text) {
  const database = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORY_STORE, "readwrite");
      const request = transaction.objectStore(STORY_STORE).add({
        text,
        savedAt: new Date().toISOString(),
      });
      let storyId;

      request.onsuccess = () => {
        storyId = request.result;
      };
      request.onerror = () => reject(
        request.error ?? new Error("No se pudo guardar la historia.")
      );
      transaction.oncomplete = () => resolve(storyId);
      transaction.onabort = () => reject(
        transaction.error ?? new Error("No se pudo completar el guardado.")
      );
    });
  } finally {
    database.close();
  }
}
