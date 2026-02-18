"""
Databoy – Flexible Flask backend
Handles ANY number of questions in ECZ Grade 7 Integrated Science papers
"""

import os
import re
import json
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, request as flask_request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from google import genai
from google.genai import types

try:
    import json5
except ImportError:
    json5 = None
    print("json5 not installed – pip install json5 recommended")

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set in .env")

client = genai.Client(api_key=GEMINI_API_KEY)

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

# Quiz storage configuration
QUIZZES_DIR = Path('quizzes')
QUIZZES_DIR.mkdir(exist_ok=True)

# D³ Engine storage configuration
D3_DIR = Path('d3_analyses')
D3_DIR.mkdir(exist_ok=True)

MODEL_NAME = "gemini-2.5-flash"  # or "gemini-2.5-flash-latest"

# ── Server-Side Quiz Storage ────────────────────────────────────────────────────

def save_quiz_to_server(quiz_name: str, quiz_data: list) -> dict:
    """Save quiz to server file system"""
    try:
        quiz_id = str(uuid.uuid4())[:8]
        quiz_entry = {
            'id': quiz_id,
            'name': quiz_name.replace('.pdf', ''),
            'timestamp': datetime.now().isoformat(),
            'questionCount': len(quiz_data),
            'data': quiz_data
        }
        
        quiz_file = QUIZZES_DIR / f'{quiz_id}.json'
        with open(quiz_file, 'w') as f:
            json.dump(quiz_entry, f, indent=2)
        
        print(f"[Storage] Quiz saved: {quiz_file}")
        return quiz_entry
    except Exception as e:
        print(f"[Storage] Failed to save quiz: {e}")
        raise

def load_quiz_from_server(quiz_id: str) -> dict:
    """Load quiz from server file system"""
    try:
        quiz_file = QUIZZES_DIR / f'{quiz_id}.json'
        if not quiz_file.exists():
            raise FileNotFoundError(f"Quiz {quiz_id} not found")
        
        with open(quiz_file, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Storage] Failed to load quiz: {e}")
        raise

def list_quizzes_from_server() -> list:
    """List all quizzes on server"""
    try:
        quizzes = []
        for quiz_file in QUIZZES_DIR.glob('*.json'):
            with open(quiz_file, 'r') as f:
                quiz_data = json.load(f)
                # Exclude the full data from list view for efficiency
                quizzes.append({
                    'id': quiz_data['id'],
                    'name': quiz_data['name'],
                    'timestamp': quiz_data['timestamp'],
                    'questionCount': quiz_data['questionCount']
                })
        return sorted(quizzes, key=lambda x: x['timestamp'], reverse=True)
    except Exception as e:
        print(f"[Storage] Failed to list quizzes: {e}")
        return []

def delete_quiz_from_server(quiz_id: str) -> bool:
    """Delete quiz from server"""
    try:
        quiz_file = QUIZZES_DIR / f'{quiz_id}.json'
        if quiz_file.exists():
            quiz_file.unlink()
            print(f"[Storage] Quiz deleted: {quiz_id}")
            return True
        return False
    except Exception as e:
        print(f"[Storage] Failed to delete quiz: {e}")
        return False

# ── Prompts ────────────────────────────────────────────────────────────────────

PROMPT_COUNT = """
This is a scanned Zambian ECZ Grade 7 Integrated Science exam paper.

Read the entire document carefully and tell me ONLY the total number of multiple-choice questions.
Look for phrases like "There are 50 questions" or count the numbered questions (1, 2, 3...).

Output ONLY a single integer (e.g. 50, 40, 60). No other text.
"""

PROMPT_ALL = """
Extract ALL multiple-choice questions from this Zambian ECZ Grade 7 Integrated Science exam paper.

Rules – follow exactly:
- Ignore instructions, headers, footers, watermarks, page numbers, STOP, QR codes.
- Fix OCR typos (assimillation → assimilation, coartem → Coartem, tse-tsefly → tsetse fly, diarrhoea → diarrhoea, anaemia → anaemia).
- Question text complete and grammatical.
- Options MUST be array of objects: [{{"letter":"A","text":"..."}}, {{"letter":"B","text":"..."}}, {{"letter":"C","text":"..."}}, {{"letter":"D","text":"..."}}] – NEVER plain strings.
- Diagrams: short neutral "diagram_description" or null.
- Deduce correct answer ("A","B","C","D") using Grade 7 science facts.
- Every object MUST have: "number" (integer starting from 1), "question", "options", "correct", "diagram_description".
- Output ONLY valid JSON array. No text, no fences, no trailing commas.

Example:
[{{"number":1,"question":"...","options":[{{"letter":"A","text":"..."}},...],"correct":"C","diagram_description":null}}, ...]
"""

PROMPT_PART = """
Extract questions from {start} to {end} only.

Same rules as above:
- Fix typos, natural text.
- Options MUST be [{{"letter":"A","text":"..."}}, {{"letter":"B","text":"..."}}, ...] – never plain strings.
- Diagrams: short description.
- Deduce correct answer.
- "number" must be integer from {start} to {end} (do NOT restart from 1).
- Output ONLY valid JSON array.
"""

# ── Helpers ────────────────────────────────────────────────────────────────────

def extract_json_array(text: str) -> list:
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.MULTILINE | re.IGNORECASE)
    text = re.sub(r'```\s*$', '', text.strip(), flags=re.MULTILINE | re.IGNORECASE)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"json.loads failed: {e}")
        if json5:
            try:
                return json5.loads(text)
            except Exception as je:
                raise ValueError(f"json5 failed: {je}")
        raise


def fix_options_format(questions: list):
    for q in questions:
        opts = q.get("options", [])
        if opts and isinstance(opts[0], str):
            fixed = []
            letters = ["A", "B", "C", "D"]
            for i, txt in enumerate(opts[:4]):
                fixed.append({"letter": letters[i], "text": txt.strip()})
            q["options"] = fixed
            print(f"Fixed options format for q{q.get('number')}")
    return questions


def normalize_field_names(questions: list):
    for q in questions:
        if "answer" in q:
            q["correct"] = q.pop("answer")
        if "text" in q and "question" not in q:
            q["question"] = q.pop("text")
        if "diagram" in q and "diagram_description" not in q:
            q["diagram_description"] = q.pop("diagram")
    return questions


def fix_numbering(questions: list, start_num: int = 1):
    for i, q in enumerate(questions, start=start_num):
        if q.get("number") != i:
            print(f"Correcting number: was {q.get('number')} → {i}")
            q["number"] = i
    return questions


def call_gemini(file_bytes: bytes, prompt: str, mime_type: str = "application/pdf") -> list:
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part(text=prompt),
                    types.Part(inline_data=types.Blob(mime_type=mime_type, data=file_bytes)),
                ]
            )
        ],
        config=types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=8192,
            response_mime_type="application/json"
        ),
    )
    raw = response.text.strip()
    print(f"[Gemini] Response length: {len(raw)} chars")
    return extract_json_array(raw)


def call_gemini_count(file_bytes: bytes, prompt: str, mime_type: str = "application/pdf") -> int:
    """Call Gemini specifically for question count (returns int, not array)"""
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text=prompt),
                        types.Part(inline_data=types.Blob(mime_type=mime_type, data=file_bytes)),
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=256
            )
        )
        raw = response.text.strip()
        print(f"[Gemini] Count response: {raw}")
        # Extract just the number from the response
        import re
        match = re.search(r'\d+', raw)
        if match:
            return int(match.group())
        raise ValueError(f"Could not extract count from: {raw}")
    except Exception as e:
        print(f"[Gemini] Count extraction error: {e}")
        raise


def process_pdf_with_gemini(file_bytes: bytes, filename: str, mime_type: str = "application/pdf") -> list:
    print(f"[Start] {filename} ({len(file_bytes)//1024} KB)")

    # Step 1: Detect total number of questions
    print("[Gemini] Detecting total questions...")
    try:
        total_questions = call_gemini_count(file_bytes, PROMPT_COUNT, mime_type)
        print(f"[Info] Paper has {total_questions} questions")
    except Exception as e:
        print(f"Count parsing failed: {e}")
        raise ValueError("Could not detect number of questions in PDF")

    # Step 2: Extraction strategy
    questions = []
    if total_questions <= 40:
        print("[Gemini] Single call – extracting all questions...")
        questions = call_gemini(file_bytes, PROMPT_ALL, mime_type)
    else:
        mid = total_questions // 2
        print(f"[Gemini] Splitting: 1–{mid} + {mid+1}–{total_questions}")
        part1_prompt = PROMPT_PART.format(start=1, end=mid)
        part2_prompt = PROMPT_PART.format(start=mid+1, end=total_questions)

        part1 = call_gemini(file_bytes, part1_prompt, mime_type)
        part2 = call_gemini(file_bytes, part2_prompt, mime_type)

        part1 = fix_options_format(part1)
        part2 = fix_options_format(part2)
        part2 = fix_numbering(part2, mid+1)

        questions = part1 + part2

    # Step 3: Final fixes
    questions = fix_options_format(questions)
    questions = normalize_field_names(questions)

    # Step 4: Validation (flexible – no hard 50)
    numbers = [q.get("number") for q in questions if isinstance(q.get("number"), int)]
    expected = list(range(1, len(questions) + 1))
    if sorted(numbers) != expected:
        print(f"Warning: numbers {sorted(numbers)} ≠ expected {expected} → auto-fixing")
        for i, q in enumerate(questions, 1):
            q["number"] = i

    print(f"[Success] Extracted {len(questions)} questions")
    return questions


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in flask_request.files and "quiz_data" not in flask_request.form:
        return jsonify({"success": False, "message": "No file or quiz_data provided"}), 400

    # Check if JSON quiz data is provided directly
    if "quiz_data" in flask_request.form:
        try:
            quiz_data = json.loads(flask_request.form["quiz_data"])
            # Validate the quiz data format
            if not isinstance(quiz_data, list):
                return jsonify({"success": False, "message": "Quiz data must be a JSON array"}), 400

            for i, q in enumerate(quiz_data):
                required_fields = ["question", "options", "correct"]
                for field in required_fields:
                    if field not in q:
                        return jsonify({"success": False, "message": f"Question {i+1} missing required field: {field}"}), 400

                # Ensure options are in the correct format
                if not isinstance(q["options"], list):
                    return jsonify({"success": False, "message": f"Question {i+1} options must be an array"}), 400

                for opt in q["options"]:
                    if not isinstance(opt, dict) or "letter" not in opt or "text" not in opt:
                        return jsonify({"success": False, "message": f"Question {i+1} options must be objects with 'letter' and 'text' fields"}), 400

            # Save to server
            quiz_entry = save_quiz_to_server('json_quiz', quiz_data)

            return jsonify({
                "success": True,
                "data": quiz_data,
                "count": len(quiz_data),
                "quizId": quiz_entry['id'],
                "message": f"Quiz loaded successfully – {len(quiz_data)} questions"
            })

        except json.JSONDecodeError:
            return jsonify({"success": False, "message": "Invalid JSON format"}), 400

    # Handle PDF file upload
    uploaded = flask_request.files["file"]
    if not uploaded.filename:
        return jsonify({"success": False, "message": "No file selected"}), 400

    mime_type = uploaded.mimetype or "application/pdf"

    try:
        file_bytes = uploaded.read()
        questions = process_pdf_with_gemini(file_bytes, uploaded.filename, mime_type)

        # Save to server
        quiz_entry = save_quiz_to_server(uploaded.filename, questions)

        return jsonify({
            "success": True,
            "data": questions,
            "count": len(questions),
            "quizId": quiz_entry['id'],
            "message": f"Extraction completed – {len(questions)} questions"
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


# ── API Endpoints for Quiz Management ───────────────────────────────────────────

@app.route("/api/quizzes", methods=["GET"])
def get_quizzes():
    """List all saved quizzes"""
    quizzes = list_quizzes_from_server()
    return jsonify({
        "success": True,
        "data": quizzes,
        "count": len(quizzes)
    })


@app.route("/api/quiz/<quiz_id>", methods=["GET"])
def get_quiz(quiz_id):
    """Load a specific quiz"""
    try:
        quiz = load_quiz_from_server(quiz_id)
        return jsonify({
            "success": True,
            "data": quiz
        })
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": f"Quiz {quiz_id} not found"
        }), 404
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route("/api/quiz/<quiz_id>", methods=["DELETE"])
def delete_quiz(quiz_id):
    """Delete a quiz"""
    if delete_quiz_from_server(quiz_id):
        return jsonify({
            "success": True,
            "message": f"Quiz {quiz_id} deleted"
        })
    else:
        return jsonify({
            "success": False,
            "message": f"Quiz {quiz_id} not found"
        }), 404


# ── D³ Engine API Endpoints ────────────────────────────────────────────────────

def extract_topics_from_text(text: str) -> list:
    """Extract key topics from text using Gemini"""
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text=f"""Analyze this educational material and extract the TOP 10 most important topics/concepts that are commonly tested in exams. 
Be concise and specific. Return ONLY a JSON array of topic strings, no other text.

Example format: ["Topic 1", "Topic 2", "Topic 3"]

Material:
{text[:3000]}""")
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.1,
                max_output_tokens=2048,
                response_mime_type="application/json"
            )
        )
        topics = json.loads(response.text)
        return topics if isinstance(topics, list) else []
    except Exception as e:
        print(f"[D3] Topic extraction failed: {e}")
        return []

def analyze_d3_documents(files_data: dict) -> dict:
    """Analyze uploaded documents with D³ Engine"""
    try:
        analysis_id = str(uuid.uuid4())[:8]
        all_topics = []
        file_summaries = []

        # Process documents
        for category, files_list in files_data.items():
            for file_obj in files_list:
                try:
                    # For demo: extract text (in production would use proper PDF/DOCX extraction)
                    filename = file_obj.filename
                    content = file_obj.read().decode('utf-8', errors='ignore')[:5000]

                    # Extract topics
                    topics = extract_topics_from_text(content)
                    all_topics.extend(topics)

                    file_summaries.append({
                        "name": filename,
                        "category": category,
                        "topics_found": len(topics),
                        "samples": topics[:3]
                    })
                except Exception as e:
                    print(f"[D3] Error processing {filename}: {e}")
                    continue

        # Deduplicate and rank topics
        from collections import Counter
        topic_counts = Counter(all_topics)
        ranked_topics = [topic for topic, _ in topic_counts.most_common(15)]

        analysis_result = {
            "id": analysis_id,
            "timestamp": datetime.now().isoformat(),
            "files_processed": len(file_summaries),
            "total_topics_found": len(all_topics),
            "ranked_topics": ranked_topics,
            "file_summaries": file_summaries,
            "status": "completed"
        }

        # Save analysis
        analysis_file = D3_DIR / f'{analysis_id}.json'
        with open(analysis_file, 'w') as f:
            json.dump(analysis_result, f, indent=2)

        print(f"[D3] Analysis saved: {analysis_file}")
        return analysis_result

    except Exception as e:
        print(f"[D3] Analysis failed: {e}")
        raise

@app.route("/api/d3-engine/train", methods=["POST"])
def train_d3_engine():
    """Train D³ Engine with uploaded documents"""
    try:
        files_data = {
            'documents': flask_request.files.getlist('documents'),
            'lectures': flask_request.files.getlist('lectures'),
            'exams': flask_request.files.getlist('exams')
        }

        # Filter empty lists
        files_data = {k: v for k, v in files_data.items() if v}

        if not files_data:
            return jsonify({
                "success": False,
                "message": "No files uploaded"
            }), 400

        # Analyze documents
        analysis = analyze_d3_documents(files_data)

        return jsonify({
            "success": True,
            "message": "D³ Engine training completed",
            "analysisId": analysis['id'],
            "topics": analysis['ranked_topics'],
            "filesProcessed": analysis['files_processed'],
            "totalTopics": analysis['total_topics_found']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@app.route("/api/d3-engine/analysis/<analysis_id>", methods=["GET"])
def get_d3_analysis(analysis_id):
    """Retrieve D³ Engine analysis results"""
    try:
        analysis_file = D3_DIR / f'{analysis_id}.json'
        if not analysis_file.exists():
            raise FileNotFoundError(f"Analysis {analysis_id} not found")

        with open(analysis_file, 'r') as f:
            analysis = json.load(f)

        return jsonify({
            "success": True,
            "data": analysis
        })
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": f"Analysis {analysis_id} not found"
        }), 404
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


if __name__ == "__main__":
    print(f"Databoy running – model: {MODEL_NAME}")
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "True").lower() == "true"
    app.run(debug=debug, port=port, host="0.0.0.0")