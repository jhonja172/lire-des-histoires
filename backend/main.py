import base64
import threading

import edge_tts
from argostranslate import package, translate
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
translation_setup_lock = threading.Lock()


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


def _get_french_to_spanish_translation():
    with translation_setup_lock:
        installed_languages = translate.get_installed_languages()
        french = next((language for language in installed_languages if language.code == "fr"), None)
        spanish = next((language for language in installed_languages if language.code == "es"), None)
        installed_packages = package.get_installed_packages()
        has_direct_translation = any(
            installed.from_code == "fr" and installed.to_code == "es"
            for installed in installed_packages
        )
        if french and spanish and has_direct_translation:
            return french.get_translation(spanish)

        package.update_package_index()
        translation_package = next(
            (
                available for available in package.get_available_packages()
                if available.from_code == "fr" and available.to_code == "es"
            ),
            None,
        )
        if translation_package is None:
            raise RuntimeError("No se encontró el paquete de traducción de francés a español.")

        package.install_from_path(translation_package.download())
        installed_languages = translate.get_installed_languages()
        french = next((language for language in installed_languages if language.code == "fr"), None)
        spanish = next((language for language in installed_languages if language.code == "es"), None)
        has_direct_translation = any(
            installed.from_code == "fr" and installed.to_code == "es"
            for installed in package.get_installed_packages()
        )
        if not french or not spanish or not has_direct_translation:
            raise RuntimeError("Argos Translate no pudo instalar el paquete francés-español.")
        return french.get_translation(spanish)


@app.post("/api/translate")
async def translate_text(request: TextRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    try:
        translation_service = await run_in_threadpool(_get_french_to_spanish_translation)
        translated_text = await run_in_threadpool(translation_service.translate, text)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return {"translation": translated_text}
