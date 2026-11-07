import base64
import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen

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


class FlashcardValidationRequest(BaseModel):
    user_answer: str = Field(..., min_length=1, max_length=2000)
    correct_answer: str = Field(..., min_length=1, max_length=2000)
    original_text: str = Field(..., min_length=1, max_length=2000)


class FlashcardScheduleRequest(BaseModel):
    flashcard_id: int = Field(..., gt=0)
    rating: Literal[1, 2, 3, 4]


def supabase_request(path: str, method: str = "GET", payload: dict | None = None) -> bytes:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(
            status_code=500,
            detail="El backend requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
        )

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = URLRequest(
        f"{supabase_url.rstrip('/')}/rest/v1/flashcards?{path}",
        data=body,
        method=method,
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            return response.read()
    except HTTPError as error:
        print(f"Supabase respondió {error.code} al {method} de flashcard.")
        raise HTTPException(
            status_code=502,
            detail="No se pudo actualizar la flashcard en Supabase.",
        ) from error
    except URLError as error:
        print(f"Error de conexión con Supabase: {error.reason}")
        raise HTTPException(
            status_code=502,
            detail="No se pudo conectar con Supabase.",
        ) from error


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


@app.post("/api/validate_flashcard")
async def validate_flashcard(request: FlashcardValidationRequest):
    user_answer = request.user_answer.strip()
    correct_answer = request.correct_answer.strip()
    original_text = request.original_text.strip()
    if not user_answer or not correct_answer or not original_text:
        raise HTTPException(
            status_code=400,
            detail="La respuesta del usuario, la respuesta correcta y la frase original son requeridas.",
        )

    prompt = (
        f"Compara la respuesta del usuario ({user_answer}) con la respuesta correcta "
        f"({correct_answer}) para la frase en francés ({original_text}). Evalúa si el "
        "significado es equivalente, aunque cambie la redacción. Responde solo con un "
        'JSON que tenga la clave "is_correct" (true/false) y una clave "feedback" con '
        "un mensaje breve de retroalimentación en español."
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
        print(f"Error validando flashcard con Gemini: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo validar la respuesta.",
        ) from error

    if not response.text:
        raise HTTPException(status_code=502, detail="Gemini no devolvió una validación.")

    try:
        result = json.loads(response.text)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Gemini devolvió una validación con formato JSON inválido.",
        ) from error

    is_correct = result.get("is_correct") if isinstance(result, dict) else None
    feedback = result.get("feedback") if isinstance(result, dict) else None
    if not isinstance(is_correct, bool) or not isinstance(feedback, str) or not feedback.strip():
        raise HTTPException(
            status_code=502,
            detail="Gemini no devolvió el resultado y la retroalimentación requeridos.",
        )

    return {"is_correct": is_correct, "feedback": feedback.strip()}


@app.post("/api/schedule_flashcard")
async def schedule_flashcard(request: FlashcardScheduleRequest):
    query = urlencode({
        "id": f"eq.{request.flashcard_id}",
        "select": "id,nivel_dominio",
    })
    try:
        rows = json.loads(await run_in_threadpool(supabase_request, query))
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Supabase devolvió datos inválidos para la flashcard.",
        ) from error

    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="No se encontró la flashcard.")

    current_level = rows[0].get("nivel_dominio")
    if not isinstance(current_level, int) or current_level < 0:
        raise HTTPException(status_code=502, detail="El nivel de dominio de la tarjeta es inválido.")

    if request.rating == 1:
        new_level = 0
        days_until_review = 0
    else:
        factor = {2: 1.2, 3: 2.5, 4: 4.0}[request.rating]
        days_until_review = 1 if current_level == 0 else math.ceil(current_level * factor)
        new_level = days_until_review

    now = datetime.now(timezone.utc)
    next_review = now + timedelta(days=days_until_review)
    update_query = urlencode({"id": f"eq.{request.flashcard_id}"})
    payload = {
        "nivel_dominio": new_level,
        "proximo_repaso": next_review.isoformat(),
    }

    try:
        updated_rows = json.loads(
            await run_in_threadpool(
                supabase_request,
                update_query,
                "PATCH",
                payload,
            )
        )
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Supabase devolvió una respuesta inválida al programar el repaso.",
        ) from error

    if not isinstance(updated_rows, list) or not updated_rows:
        raise HTTPException(
            status_code=502,
            detail="Supabase no confirmó la actualización de la flashcard.",
        )

    return {
        "days_until_review": days_until_review,
        "nivel_dominio": new_level,
        "proximo_repaso": next_review.isoformat(),
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
