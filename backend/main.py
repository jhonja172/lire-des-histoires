import base64
import json
import os

import edge_tts
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICE = "fr-CA-AntoineNeural"


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class FlashcardRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=200)
    paragraph: str = Field(..., min_length=1, max_length=5000)


@app.get("/")
def read_root():
    return {"message": "Backend de Lire des Histoires listo"}


@app.post("/api/audio")
async def generate_audio(request: TextRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    communicator = edge_tts.Communicate(text, VOICE, boundary="WordBoundary")
    audio_chunks = []
    word_boundaries = []

    async for chunk in communicator.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            print(f"WordBoundary: {chunk}")
            word_boundaries.append(
                {
                    "text": chunk["text"],
                    "start": chunk["offset"] / 10_000_000,
                    "duration": chunk["duration"] / 10_000_000,
                }
            )

    if not audio_chunks:
        raise HTTPException(status_code=502, detail="El servicio de voz no devolvió audio.")

    audio_base64 = base64.b64encode(b"".join(audio_chunks)).decode("ascii")
    return {
        "audio_base64": audio_base64,
        "word_boundaries": word_boundaries,
    }


@app.post("/api/generate_flashcard")
async def generate_flashcard(request: FlashcardRequest):
    word = request.word.strip()
    paragraph = request.paragraph.strip()
    if not word or not paragraph:
        raise HTTPException(status_code=400, detail="La palabra y el párrafo no pueden estar vacíos.")

    prompt = (
        f"Eres un profesor de francés. Dada esta palabra: '{word}' y este párrafo de "
        f"contexto: '{paragraph}', extrae o crea UNA SOLA ORACIÓN corta en francés "
        f"que contenga la palabra '{word}' y que sea fácil de entender. Devuelve el "
        "resultado en formato JSON con las claves 'frase_francesa' y "
        "'traduccion_espanola'."
    )

    try:
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        response = await run_in_threadpool(
            lambda: client.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
        )
    except Exception as error:
        print(f"Error generando flashcard con Gemini: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo generar la flashcard.",
        ) from error

    if not response.text:
        raise HTTPException(status_code=502, detail="Gemini no devolvió una flashcard.")

    try:
        result = json.loads(response.text)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Gemini devolvió una flashcard con formato JSON inválido.",
        ) from error

    french = result.get("frase_francesa") if isinstance(result, dict) else None
    spanish = result.get("traduccion_espanola") if isinstance(result, dict) else None
    if (
        not isinstance(french, str)
        or not french.strip()
        or not isinstance(spanish, str)
        or not spanish.strip()
    ):
        raise HTTPException(
            status_code=502,
            detail="Gemini no devolvió los campos de frase y traducción requeridos.",
        )

    return {
        "frase_francesa": french.strip(),
        "traduccion_espanola": spanish.strip(),
    }


@app.post("/api/translate")
async def translate_text(request: TextRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    prompt = (
        f"Traduce el siguiente texto del francés al español. "
        f"Devuelve únicamente la traducción, sin explicaciones ni comillas: {text}"
    )

    try:
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        response = await run_in_threadpool(
            lambda: client.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents=prompt,
            )
        )
    except Exception as e:
        print(f"Error en Gemini: {e}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo traducir el texto.",
        ) from e

    if not response.text:
        raise HTTPException(status_code=500, detail="Gemini no devolvió una traducción.")

    return {"translation": response.text}
