import base64
import os

import edge_tts
from google import genai
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


@app.get("/")
def read_root():
    return {"message": "Backend de Lire des Histoires listo"}


@app.post("/api/audio")
async def generate_audio(request: TextRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    communicator = edge_tts.Communicate(text, VOICE)
    audio_chunks = []
    word_boundaries = []

    async for chunk in communicator.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
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
