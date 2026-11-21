import json
import math
import os
import tempfile
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen
from uuid import UUID

import edge_tts
from edge_tts.exceptions import EdgeTTSException
from google import genai
from google.genai import errors
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from supabase import create_client

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

EDGE_TTS_VOICE = "fr-CA-AntoineNeural"
GEMINI_API_KEYS = [
    key.strip()
    for key in os.environ.get("GEMINI_API_KEYS", "").split(",")
    if key.strip()
]
_gemini_api_key_index = 0
_gemini_api_key_lock = Lock()


def get_next_gemini_api_key():
    if not GEMINI_API_KEYS:
        raise HTTPException(
            status_code=500,
            detail="No hay claves configuradas en GEMINI_API_KEYS.",
        )

    global _gemini_api_key_index
    with _gemini_api_key_lock:
        api_key = GEMINI_API_KEYS[_gemini_api_key_index]
        _gemini_api_key_index = (_gemini_api_key_index + 1) % len(GEMINI_API_KEYS)
    return api_key


async def generate_content_with_key_rotation(
    prompt,
    model,
    config=None,
    api_version=None,
    timeout_seconds=None,
):
    if not GEMINI_API_KEYS:
        get_next_gemini_api_key()

    deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
    for attempt in range(len(GEMINI_API_KEYS)):
        http_options = {}
        if api_version:
            http_options["api_version"] = api_version
        if deadline is not None:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise HTTPException(
                    status_code=504,
                    detail="La generación de preguntas tardó demasiado. Inténtalo de nuevo.",
                )
            http_options["timeout"] = max(1, int(remaining_seconds * 1000))
            http_options["retry_options"] = types.HttpRetryOptions(attempts=1)

        client_options = {"api_key": get_next_gemini_api_key()}
        if http_options:
            client_options["http_options"] = types.HttpOptions(**http_options)

        client = genai.Client(**client_options)
        try:
            if config is None:
                response = await run_in_threadpool(
                    lambda: client.models.generate_content(model=model, contents=prompt)
                )
            else:
                response = await run_in_threadpool(
                    lambda: client.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=config,
                    )
                )
            return response
        except errors.APIError as error:
            if error.code not in {429, 503}:
                raise

            if deadline is not None and time.monotonic() >= deadline:
                raise HTTPException(
                    status_code=504,
                    detail="La generación de preguntas tardó demasiado. Inténtalo de nuevo.",
                ) from error

            print(
                f"Gemini respondió {error.code}; probando la siguiente clave "
                f"({attempt + 1}/{len(GEMINI_API_KEYS)})."
            )
        except Exception as error:
            if deadline is not None and time.monotonic() >= deadline:
                raise HTTPException(
                    status_code=504,
                    detail="La generación de preguntas tardó demasiado. Inténtalo de nuevo.",
                ) from error
            raise

    raise HTTPException(
        status_code=503,
        detail=(
            "El servicio de IA está temporalmente ocupado o se agotó la cuota "
            "de las claves configuradas. Inténtalo de nuevo más tarde."
        ),
    )


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class QuizRequest(BaseModel):
    texto: str = Field(..., min_length=1, max_length=5000)
    nivel: Literal["A1", "B1", "B2"] = "A1"


class FlashcardRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=200)
    paragraph: str = Field(..., min_length=1, max_length=5000)


class FlashcardSaveRequest(BaseModel):
    frase_francesa: str = Field(..., min_length=1, max_length=2000)
    traduccion_espanola: str = Field(..., min_length=1, max_length=2000)


class FlashcardValidationRequest(BaseModel):
    user_answer: str = Field(..., min_length=1, max_length=2000)
    correct_answer: str = Field(..., min_length=1, max_length=2000)
    original_text: str = Field(..., min_length=1, max_length=2000)


class FlashcardScheduleRequest(BaseModel):
    flashcard_id: int = Field(..., gt=0)
    rating: Literal[1, 2, 3, 4]


class AttemptRequest(BaseModel):
    tipo: Literal["quiz", "flashcard"]
    acierto: bool
    tema: str = Field(..., min_length=1, max_length=2000)
    historia_id: UUID | None = Field(default=None)


def supabase_request(path: str, method: str = "GET", payload: dict | None = None) -> bytes:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(
            status_code=500,
            detail="El backend requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
        )

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    query = f"?{path}" if path else ""
    request = URLRequest(
        f"{supabase_url.rstrip('/')}/rest/v1/flashcards{query}",
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


@app.api_route("/", methods=["GET", "HEAD"])
def read_root():
    return {"message": "Backend de Lire des Histoires listo"}


def remove_temp_audio_file(file_path: str) -> None:
    try:
        os.remove(file_path)
    except FileNotFoundError:
        pass


@app.post("/api/audio")
async def generate_audio(request: TextRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as audio_file:
        file_path = audio_file.name

    audio_generated = False
    try:
        print(f"Generando audio con edge-tts (voz {EDGE_TTS_VOICE}).")
        communicator = edge_tts.Communicate(
            text,
            EDGE_TTS_VOICE,
            rate="-15%",
        )
        await communicator.save(file_path)
        audio_generated = True
    except (EdgeTTSException, OSError, TimeoutError) as error:
        print(f"Error generando audio con edge-tts: {error}")
        raise HTTPException(
            status_code=502,
            detail="No se pudo generar el audio con edge-tts.",
        ) from error
    finally:
        if not audio_generated:
            remove_temp_audio_file(file_path)

    if os.path.getsize(file_path) == 0:
        remove_temp_audio_file(file_path)
        raise HTTPException(status_code=502, detail="edge-tts devolvió un archivo de audio vacío.")

    print("edge-tts generó correctamente el archivo de audio.")
    return FileResponse(
        file_path,
        media_type="audio/mpeg",
        filename="historia.mp3",
        background=BackgroundTask(remove_temp_audio_file, file_path),
    )


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
        response = await generate_content_with_key_rotation(
            prompt,
            "gemini-3.5-flash-lite",
            types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except HTTPException:
        raise
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
        response = await generate_content_with_key_rotation(
            prompt,
            "gemini-3.5-flash-lite",
            types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except HTTPException:
        raise
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


@app.post("/api/save_flashcard")
async def save_flashcard(request: FlashcardSaveRequest):
    french = request.frase_francesa.strip()
    spanish = request.traduccion_espanola.strip()
    if not french or not spanish:
        raise HTTPException(
            status_code=400,
            detail="La frase en francés y su traducción son requeridas.",
        )

    try:
        response_body = await run_in_threadpool(
            supabase_request,
            "",
            "POST",
            {
                "frase_francesa": french,
                "traduccion_espanola": spanish,
            },
        )
    except HTTPException:
        raise

    try:
        saved_rows = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Supabase devolvió una respuesta inválida al guardar la flashcard.",
        ) from error

    if not isinstance(saved_rows, list) or not saved_rows:
        raise HTTPException(
            status_code=502,
            detail="Supabase no confirmó el guardado de la flashcard.",
        )

    return {"flashcard": saved_rows[0]}


def insert_attempt(payload: dict) -> dict:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(
            status_code=500,
            detail="El backend requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
        )

    response = (
        create_client(supabase_url, service_role_key)
        .table("historial_intentos")
        .insert(payload)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=502,
            detail="Supabase no confirmó el guardado del intento.",
        )
    return response.data[0]


@app.post("/api/guardar_intento")
async def save_attempt(request: AttemptRequest):
    payload = {
        "tipo": request.tipo,
        "acierto": request.acierto,
        "tema": request.tema.strip(),
        "historia_id": str(request.historia_id) if request.historia_id else None,
    }
    if not payload["tema"]:
        raise HTTPException(status_code=400, detail="El tema no puede estar vacío.")
    if request.tipo == "quiz" and len(payload["tema"].split()) > 3:
        raise HTTPException(
            status_code=400,
            detail="El tema del Quiz debe tener como máximo 3 palabras.",
        )

    try:
        saved_attempt = await run_in_threadpool(insert_attempt, payload)
    except HTTPException:
        raise
    except Exception as error:
        print(f"Error guardando intento en Supabase: {error}")
        raise HTTPException(
            status_code=502,
            detail="No se pudo guardar el intento en Supabase.",
        ) from error

    return {"intento": saved_attempt}


def read_attempt_statistics() -> dict:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(
            status_code=500,
            detail="El backend requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
        )

    client = create_client(supabase_url, service_role_key)
    attempts, _ = fetch_all_rows(
        client.table("historial_intentos"),
        "tipo,acierto,tema",
    )
    cards, total_cards = fetch_all_rows(
        client.table("flashcards"),
        "id,nivel_dominio,frase_francesa",
    )

    quiz_attempts = [attempt for attempt in attempts if attempt.get("tipo") == "quiz"]
    flashcard_attempts = [
        attempt for attempt in attempts if attempt.get("tipo") == "flashcard"
    ]

    topic_totals = Counter()
    topic_correct = Counter()
    for attempt in quiz_attempts:
        raw_topic = attempt.get("tema")
        topic = raw_topic.strip() if isinstance(raw_topic, str) else ""
        if not topic or len(topic.split()) > 3:
            continue
        topic_totals[topic] += 1
        if attempt.get("acierto") is True:
            topic_correct[topic] += 1

    total_quiz = len(quiz_attempts)
    correct_quiz = sum(attempt.get("acierto") is True for attempt in quiz_attempts)
    total_flashcard_reviews = len(flashcard_attempts)
    correct_flashcard_reviews = sum(
        attempt.get("acierto") is True for attempt in flashcard_attempts
    )

    flashcard_fronts = {
        card["frase_francesa"].strip()
        for card in cards
        if isinstance(card.get("frase_francesa"), str) and card["frase_francesa"].strip()
    }
    difficult_cards = Counter(
        topic
        for attempt in flashcard_attempts
        if attempt.get("acierto") is False
        and isinstance((topic := attempt.get("tema")), str)
        and topic.strip()
    )
    card_failures = Counter()
    for topic, failures in difficult_cards.items():
        if topic in flashcard_fronts:
            card_failures[topic] += failures
            continue
        if len(topic) == 500:
            matching_fronts = [
                front for front in flashcard_fronts if front.startswith(topic)
            ]
            if len(matching_fronts) == 1:
                card_failures[matching_fronts[0]] += failures

    ranked_cards = []
    for card in cards:
        front = card.get("frase_francesa")
        if not isinstance(front, str) or not front.strip():
            continue
        front = front.strip()
        mastery_level = card.get("nivel_dominio")
        if not isinstance(mastery_level, (int, float)) or isinstance(mastery_level, bool):
            mastery_level = 0
        ranked_cards.append(
            {
                "frente": front,
                "fallos": card_failures[front],
                "nivel_dominio": mastery_level,
            }
        )
    ranked_cards.sort(
        key=lambda card: (
            -card["fallos"],
            card["nivel_dominio"],
            card["frente"].casefold(),
        )
    )

    top_quiz_topics = sorted(
        topic_totals,
        key=lambda topic: (-topic_totals[topic], topic.casefold()),
    )[:5]
    weakest_quiz_topics = sorted(
        (
            topic
            for topic in topic_totals
            if topic_totals[topic] > topic_correct[topic]
        ),
        key=lambda topic: (
            -(topic_totals[topic] - topic_correct[topic]),
            topic_correct[topic] / topic_totals[topic],
            topic.casefold(),
        ),
    )[:3]
    return {
        "quiz": {
            "precision_global": round(correct_quiz / total_quiz * 100, 2)
            if total_quiz
            else 0.0,
            "total_respondidas": total_quiz,
            "desglose": [
                {
                    "categoria": topic,
                    "porcentaje": round(
                        topic_correct[topic] / topic_totals[topic] * 100,
                        2,
                    )
                    if topic_totals[topic]
                    else 0.0,
                }
                for topic in top_quiz_topics
            ],
            "puntos_debiles": [
                {
                    "tema": topic,
                    "fallos": topic_totals[topic] - topic_correct[topic],
                    "porcentaje": round(
                        topic_correct[topic] / topic_totals[topic] * 100,
                        2,
                    ),
                }
                for topic in weakest_quiz_topics
            ],
        },
        "flashcards": {
            "tasa_retencion": round(
                correct_flashcard_reviews / total_flashcard_reviews * 100,
                2,
            )
            if total_flashcard_reviews
            else 0.0,
            "tarjetas_dominadas": sum(
                isinstance(card.get("nivel_dominio"), (int, float))
                and not isinstance(card.get("nivel_dominio"), bool)
                and card["nivel_dominio"] > 0
                for card in cards
            ),
            "total_tarjetas": total_cards,
            "total_repasadas": total_flashcard_reviews,
            "tarjetas_dificiles": [
                {
                    "frente": card["frente"],
                    "fallos": card["fallos"],
                    "nivel_dominio": card["nivel_dominio"],
                }
                for card in ranked_cards[:3]
            ],
        },
    }


def fetch_all_rows(table, columns: str) -> tuple[list[dict], int]:
    page_size = 1000
    first_page = table.select(columns, count="exact").range(0, page_size - 1).execute()
    total = first_page.count or 0
    rows = list(first_page.data or [])

    while len(rows) < total:
        start = len(rows)
        page = table.select(columns).range(start, start + page_size - 1).execute().data or []
        if not page:
            raise HTTPException(
                status_code=502,
                detail="No se pudo completar la lectura de las estadísticas.",
            )
        rows.extend(page)

    return rows[:total], total


@app.get("/api/estadisticas")
async def get_statistics():
    try:
        return await run_in_threadpool(read_attempt_statistics)
    except HTTPException:
        raise
    except Exception as error:
        print(f"Error consultando estadísticas en Supabase: {error}")
        raise HTTPException(
            status_code=502,
            detail="No se pudieron cargar las estadísticas.",
        ) from error


@app.post("/api/generar_preguntas")
async def generate_quiz(request: QuizRequest):
    text = request.texto.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    if request.nivel == "A1":
        level_instruction = (
            "Nivel A1 (Principiante): formula preguntas de comprensión literal "
            "sobre información explícita y directa del texto."
        )
    elif request.nivel == "B1":
        level_instruction = (
            "Nivel B1 (Intermedio): formula preguntas que requieran relacionar "
            "hechos y comprender relaciones de causa y efecto."
        )
    else:
        level_instruction = (
            "Nivel B2 (Avanzado): formula preguntas que requieran inferencias, "
            "interpretación de matices y análisis del contexto, además de "
            "comprensión de información explícita."
        )

    prompt = (
        "Es OBLIGATORIO que generes 5 preguntas de comprensión lectora completamente "
        "diferentes a las anteriores. Varía los personajes, las acciones y las "
        "estructuras. No repitas preguntas ni opciones. "
        f"{level_instruction} "
        "Para evitar repeticiones, concéntrate en generar preguntas sobre aspectos "
        "del texto que no hayas explorado antes. Varía el foco: si en una pregunta "
        "anterior te centraste en un personaje, ahora céntrate en otro, en una acción "
        "secundaria, en una descripción o en una relación causa-efecto. No repitas "
        "las mismas estructuras de pregunta. "
        "Devuelve el campo 'tema' con una etiqueta gramatical o de vocabulario de "
        "máximo 3 palabras (Ejemplos: 'Passé Composé', 'Preposiciones', "
        "'Vocabulario fábrica'). NUNCA devuelvas el título de la historia como tema. "
        f"Eres un profesor de francés. Lee este texto: '{text}'. Genera exactamente "
        "5 preguntas de comprensión lectora en francés. Para cada pregunta, devuelve un JSON "
        "estricto con esta estructura: "
        '[{"pregunta": "...", "opciones": ["A", "B", "C", "D"], '
        '"respuesta_correcta": "A", "explicacion": "Breve explicación en español '
        'de por qué es la respuesta correcta basada en el texto", '
        '"tema": "Categoría específica y breve de la pregunta", '
        '"oracion_contexto": "Oración completa y nueva en francés que use la misma '
        'palabra clave o estructura gramatical", '
        '"traduccion_contexto": "Traducción al español de la oración de contexto"}]'
    )

    quiz_started_at = time.monotonic()
    print("Ejecutando Gemini para generar preguntas de comprensión.")
    try:
        print("Usando modelo Gemini: gemini-3.5-flash-lite (API v1beta).")
        response = await generate_content_with_key_rotation(
            prompt,
            "gemini-3.5-flash-lite",
            types.GenerateContentConfig(
                temperature=1.0,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_level="LOW"),
            ),
            api_version="v1beta",
            timeout_seconds=22,
        )
        print(
            "Gemini generó correctamente las preguntas en "
            f"{time.monotonic() - quiz_started_at:.2f}s."
        )
    except HTTPException:
        raise
    except Exception as error:
        print(f"Error generando preguntas con Gemini: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudieron generar las preguntas.",
        ) from error

    if not response.text:
        raise HTTPException(status_code=502, detail="Gemini no devolvió preguntas.")

    cleaned_response = response.text.strip()
    if cleaned_response.startswith("```"):
        cleaned_response = cleaned_response[3:].lstrip()
        if cleaned_response[:4].lower() == "json":
            cleaned_response = cleaned_response[4:].lstrip()
        if cleaned_response.endswith("```"):
            cleaned_response = cleaned_response[:-3].rstrip()

    try:
        result = json.loads(cleaned_response)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502,
            detail="Gemini devolvió preguntas con formato JSON inválido.",
        ) from error

    if not isinstance(result, list) or len(result) != 5:
        raise HTTPException(
            status_code=502,
            detail="Gemini no devolvió exactamente 5 preguntas.",
        )

    validated_questions = []
    for question in result:
        if not isinstance(question, dict):
            raise HTTPException(status_code=502, detail="Gemini devolvió una pregunta inválida.")

        statement = question.get("pregunta")
        options = question.get("opciones")
        correct_answer = question.get("respuesta_correcta")
        explanation = question.get("explicacion")
        topic = question.get("tema")
        context_sentence = question.get("oracion_contexto")
        context_translation = question.get("traduccion_contexto")
        if (
            not isinstance(statement, str)
            or not statement.strip()
            or not isinstance(options, list)
            or len(options) != 4
            or any(not isinstance(option, str) or not option.strip() for option in options)
            or not isinstance(correct_answer, str)
            or correct_answer.strip() not in [option.strip() for option in options]
            or not isinstance(explanation, str)
            or not explanation.strip()
            or not isinstance(topic, str)
            or not topic.strip()
            or len(topic.strip().split()) > 3
            or len(topic.strip()) > 120
            or not isinstance(context_sentence, str)
            or not context_sentence.strip()
            or not isinstance(context_translation, str)
            or not context_translation.strip()
        ):
            raise HTTPException(status_code=502, detail="Gemini devolvió una pregunta inválida.")

        validated_questions.append(
            {
                "pregunta": statement.strip(),
                "opciones": [option.strip() for option in options],
                "respuesta_correcta": correct_answer.strip(),
                "explicacion": explanation.strip(),
                "tema": topic.strip(),
                "oracion_contexto": context_sentence.strip(),
                "traduccion_contexto": context_translation.strip(),
            }
        )

    print(
        "Respuesta del Quiz lista para enviar en "
        f"{time.monotonic() - quiz_started_at:.2f}s."
    )
    return validated_questions


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
        response = await generate_content_with_key_rotation(
            prompt,
            "gemini-3.5-flash-lite",
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error en Gemini: {e}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo traducir el texto.",
        ) from e

    if not response.text:
        raise HTTPException(status_code=500, detail="Gemini no devolvió una traducción.")

    return {"translation": response.text}
