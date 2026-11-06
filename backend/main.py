from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Backend de Lire des Histoires listo"}


@app.post("/api/audio")
async def generate_audio(text: str):
    # Aquí irá la lógica de edge-tts luego
    return {"status": "success", "texto": text}
