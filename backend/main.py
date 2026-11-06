import base64

import edge_tts
from deep_translator import GoogleTranslator
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

    try:
        translated = await run_in_threadpool(
            lambda: GoogleTranslator(source="fr", target="es").translate(text)
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="No se pudo traducir el texto.",
        ) from error

    return {"translation": translated}
