import sys
import json
import argparse
import os
from faster_whisper import WhisperModel

# Desactivar avisos de GPU si no hay
os.environ["KMP_DUPLICATE_LIB_OK"]="TRUE"

def transcribe(audio_path, model_size="small", language="es"):
    try:
        # Cargar el modelo
        # En CPU se recomienda compute_type="int8" para máxima velocidad y ahorro de RAM
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        # beam_size=5 es un buen balance entre calidad y velocidad
        segments, info = model.transcribe(audio_path, beam_size=5, language=language)

        full_text = ""
        for segment in segments:
            full_text += segment.text + " "

        result = {
            "text": full_text.strip(),
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration
        }
        
        # El resultado final se imprime en stdout como JSON
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        error_result = {
            "error": str(e)
        }
        # Los errores van a stderr
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcripción local usando faster-whisper")
    parser.add_argument("audio_path", help="Ruta al archivo de audio")
    parser.add_argument("--model", default="small", help="Tamaño del modelo (tiny, base, small, medium, large-v3)")
    parser.add_argument("--lang", default="es", help="Idioma (es, en, etc.)")

    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Archivo no encontrado: {args.audio_path}"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    transcribe(args.audio_path, args.model, args.lang)
