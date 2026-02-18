# Databoy – Interactive Quiz Platform

An EdTech platform that reduces student study time by 50% through ML-driven identification of exam-relevant content and active-recall quizzing.

## Features

- **Smart Revision**: Upload exam PDFs → Auto-extract questions → Auto-marked quizzes with instant feedback
- **D³ Engine**: Data-Driven Decision Engine that analyzes documents, lectures, and past exams to identify exam-relevant topics
- **Server-side Persistence**: Quizzes stored on backend for cross-device access
- **Real-time Marking**: Instant feedback on quiz answers with detailed results

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Flask (Python 3.8+)
- **AI/ML**: Google Gemini 2.5-flash for PDF processing and topic analysis
- **Storage**: File-based JSON (quizzes/, d3_analyses/)

## Local Setup

```bash
# Clone repository
git clone <repo-url>
cd Databoy

# Install dependencies
pip install -r requirements.txt

# Create .env file with your API key
echo "GEMINI_API_KEY=your_api_key_here" > .env

# Run server
python app.py
```

Visit: **http://localhost:5000/dashboard.html**

## Deployment

### Option 1: Render (Recommended)

1. Push code to GitHub
2. Create account on [render.com](https://render.com)
3. Create new "Web Service" → Connect GitHub repo
4. Set environment variable:
   - `GEMINI_API_KEY` = your API key
5. Deploy!

### Option 2: Railway

1. Push code to GitHub
2. Create account on [railway.app](https://railway.app)
3. Create new project → Import GitHub repo
4. Add environment variable: `GEMINI_API_KEY`
5. Deploy!

### Option 3: PythonAnywhere

1. Create account on [pythonanywhere.com](https://www.pythonanywhere.com)
2. Upload files via Web UI
3. Set up web app with Flask + set environment variables
4. Deploy!

## Environment Variables

Required:
- `GEMINI_API_KEY` – Google Gemini API key (get from [aistudio.google.com](https://aistudio.google.com))

Optional:
- `PORT` – Server port (default: 5000)
- `DEBUG` – Enable debug mode (default: True for local, False for production)

## API Endpoints

### Quiz Management
- `POST /upload` – Upload PDF, extract questions
- `GET /api/quizzes` – List saved quizzes
- `GET /api/quiz/<id>` – Retrieve specific quiz
- `DELETE /api/quiz/<id>` – Delete quiz

### D³ Engine
- `POST /api/d3-engine/train` – Train engine with documents
- `GET /api/d3-engine/analysis/<id>` – Get analysis results

### Health
- `GET /health` – Check server status and model availability

## Project Structure

```
Databoy/
├── app.py                 # Flask backend
├── app_demo.html          # Quiz application
├── dashboard.html         # Feature showcase
├── index.html             # Landing page
├── script.js              # Quiz logic
├── style.css              # Styling
├── requirements.txt       # Python dependencies
├── Procfile              # Deployment config
├── .env                  # Environment variables (not in git)
├── .gitignore           # Git exclusions
├── quizzes/             # Stored quiz data
└── d3_analyses/         # D³ Engine results
```

## Getting an API Key

1. Visit [Google AI Studio](https://aistudio.google.com)
2. Click "Create API Key"
3. Copy the key
4. Add to `.env` as `GEMINI_API_KEY=your_key`

**Note**: Free tier allows 20 requests/day. Upgrade for production use.

## Support

For issues, check:
1. API key is valid and added to `.env`
2. All dependencies installed: `pip install -r requirements.txt`
3. Server running: Check health at `/health` endpoint
4. PDF is a valid exam paper format

## License

Educational use only.
