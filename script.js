/* ============================================================
   Databoy – App Demo Script
   Two sections: Smart Revision (PDF → Quiz) | Road Map
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
    quizData: [],   // [{question, options, answer}, ...]
    quizId: null,   // Server-side quiz ID
    currentIndex: 0,
    score: 0,
    answered: false,
    userAnswers: [], // Track user's selected answers
    uploadedSources: new Set(),
    activeTab: 'revision'
};

// ── Quiz Storage (LocalStorage) ────────────────────────────────────────────────
const STORAGE_KEY = 'databoy_quizzes';

function saveQuizToStorage(quizName, quizData, serverQuizId = null) {
    try {
        const quizzes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const timestamp = new Date().toISOString();
        const quizEntry = {
            id: serverQuizId || `local_${Date.now()}`,
            serverId: serverQuizId,
            name: quizName.replace('.pdf', ''),
            timestamp,
            data: quizData,
            questionCount: quizData.length
        };
        quizzes.push(quizEntry);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(quizzes));
        console.log(`✓ Quiz saved locally: ${quizName} (${quizData.length} questions)`);
        return quizEntry.id;
    } catch (err) {
        console.error('Failed to save quiz:', err);
    }
}

function loadQuizzesFromStorage() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (err) {
        console.error('Failed to load quizzes:', err);
        return [];
    }
}

function deleteQuizFromStorage(quizId) {
    try {
        const quizzes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const filtered = quizzes.filter(q => q.id !== quizId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        console.log(`✓ Quiz deleted: ${quizId}`);
    } catch (err) {
        console.error('Failed to delete quiz:', err);
    }
}



// ── Server Quiz Management ──────────────────────────────────────────────────────

async function loadQuizzesFromServer() {
    try {
        const response = await fetch('/api/quizzes');
        const result = await response.json();
        if (result.success) {
            return result.data;
        }
        return [];
    } catch (err) {
        console.error('Failed to load quizzes from server:', err);
        return [];
    }
}

async function loadQuizFromServer(quizId) {
    try {
        const response = await fetch(`/api/quiz/${quizId}`);
        const result = await response.json();
        if (result.success) {
            return result.data;
        }
        throw new Error(result.message);
    } catch (err) {
        console.error('Failed to load quiz from server:', err);
        throw err;
    }
}

async function deleteQuizFromServer(quizId) {
    try {
        const response = await fetch(`/api/quiz/${quizId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            console.log(`✓ Quiz deleted: ${quizId}`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('Failed to delete quiz from server:', err);
        return false;
    }
}

window.openSavedQuiz = async function (quizId) {
    try {
        showProcessing(true);
        setStep('step-parse', 'active');
        updateLabel('Loading quiz from server...');

        const quizEntry = await loadQuizFromServer(quizId);

        setStep('step-parse', 'done');
        setStep('step-quiz', 'active');
        updateLabel('Building interactive quiz...');

        await sleep(500);
        setStep('step-quiz', 'done');

        state.quizData = quizEntry.data;
        state.quizId = quizEntry.id;
        state.currentIndex = 0;
        state.score = 0;
        state.answered = false;
        state.userAnswers = new Array(quizEntry.data.length).fill(null);

        showProcessing(false);
        closeSavedQuizzes();
        renderQuiz();
    } catch (err) {
        showProcessing(false);
        resetSteps();
        alert('Failed to load quiz: ' + err.message);
    }
};

window.showSavedQuizzes = async function () {
    const modal = document.getElementById('saved-quizzes-modal');
    const listEl = document.getElementById('saved-quizzes-list');
    
    modal.style.display = 'flex';
    listEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading quizzes...</p>';

    try {
        const quizzes = await loadQuizzesFromServer();
        
        if (quizzes.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No saved quizzes yet. Upload a PDF to get started!</p>';
            return;
        }

        listEl.innerHTML = '';
        quizzes.forEach(quiz => {
            const date = new Date(quiz.timestamp).toLocaleDateString();
            const item = document.createElement('div');
            item.style.cssText = 'background:var(--bg-dark); border:1px solid rgba(100,255,218,0.2); border-radius:10px; padding:1rem; display:flex; align-items:center; justify-content:space-between; gap:1rem;';
            item.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:600; color:var(--text-primary);">${quiz.name}</div>
                    <div style="font-size:0.8rem; color:var(--text-secondary);">${quiz.questionCount} questions • ${date}</div>
                </div>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn btn-primary" onclick="openSavedQuiz('${quiz.id}')" style="padding:0.5rem 1rem; font-size:0.9rem;">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-secondary" onclick="deleteSavedQuiz('${quiz.id}')" style="padding:0.5rem 1rem; font-size:0.9rem;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            listEl.appendChild(item);
        });
    } catch (err) {
        listEl.innerHTML = `<p style="color:#ff6b6b; text-align:center;"><i class="fas fa-exclamation-circle"></i> Failed to load quizzes</p>`;
    }
};

window.closeSavedQuizzes = function () {
    const modal = document.getElementById('saved-quizzes-modal');
    modal.style.display = 'none';
};

window.deleteSavedQuiz = async function (quizId) {
    if (!confirm('Delete this quiz?')) return;
    
    const success = await deleteQuizFromServer(quizId);
    if (success) {
        // Refresh the list
        await showSavedQuizzes();
    } else {
        alert('Failed to delete quiz');
    }
};

// ── Tab Switching ──────────────────────────────────────────────────────────────
window.switchTab = function (tab, el) {
    state.activeTab = tab;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    // Toggle left panel content
    document.getElementById('revision-upload').style.display = tab === 'revision' ? 'block' : 'none';
    document.getElementById('roadmap-upload').style.display = tab === 'roadmap' ? 'block' : 'none';

    // Toggle right panel content
    document.getElementById('quiz-output').style.display = tab === 'revision' ? 'block' : 'none';
    document.getElementById('roadmap-output').style.display = tab === 'roadmap' ? 'block' : 'none';
};



// ── File Upload (Smart Revision) ───────────────────────────────────────────────
window.handleFileUpload = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate type
    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }

    // Show processing state
    showProcessing(true);
    setStep('step-upload', 'active');

    const formData = new FormData();
    formData.append('file', file);

    try {
        // Step 1: Upload
        setStep('step-upload', 'done');
        setStep('step-docai', 'active');
        updateLabel('Sending to Google Document AI...');

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        // Step 2: DocAI done
        setStep('step-docai', 'done');
        setStep('step-parse', 'active');
        updateLabel('Parsing questions to JSON...');

        const result = await response.json();

        if (!result.success) throw new Error(result.message || 'Processing failed');

        // Step 3: Parse done
        setStep('step-parse', 'done');
        setStep('step-quiz', 'active');
        updateLabel('Building interactive quiz...');

        await sleep(500); // brief pause for UX

        setStep('step-quiz', 'done');

        if (!result.data || result.data.length === 0) {
            throw new Error('No questions found in the PDF. Make sure it contains numbered MCQ questions (e.g. "1. Question... A. Option...")');
        }

        // Store quiz data
        state.quizData = result.data;
        state.quizId = result.quizId || null; // Store server quiz ID
        state.currentIndex = 0;
        state.score = 0;
        state.answered = false;
        state.userAnswers = new Array(result.data.length).fill(null); // Initialize with nulls

        // Auto-save to localStorage
        saveQuizToStorage(file.name, result.data, result.quizId);

        // Show file info
        showFileInfo(file, result.data.length);

        // Render quiz
        showProcessing(false);
        renderQuiz();

    } catch (err) {
        showProcessing(false);
        resetSteps();
        console.error(err);

        // Distinguish network errors from server errors
        const isNetworkError = err instanceof TypeError && err.message.toLowerCase().includes('fetch');
        if (isNetworkError) {
            alert('Cannot reach the backend server.\n\nPlease run this command in your terminal:\n\n  python app.py\n\nThen try uploading again.');
        } else {
            alert('Processing error: ' + err.message);
        }
        // Reset file input
        document.getElementById('pdf-input').value = '';
    }
};

// ── JSON Input Handling ─────────────────────────────────────────────────────────
window.handleJsonInput = async function () {
    const jsonText = document.getElementById('json-input').value.trim();
    if (!jsonText) {
        alert('Please enter JSON quiz data.');
        return;
    }

    // Show processing state
    showProcessing(true);
    setStep('step-upload', 'active');
    updateLabel('Validating JSON...');

    try {
        const formData = new FormData();
        formData.append('quiz_data', jsonText);

        setStep('step-upload', 'done');
        setStep('step-parse', 'active');
        updateLabel('Processing quiz data...');

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        setStep('step-parse', 'done');
        setStep('step-quiz', 'active');
        updateLabel('Building interactive quiz...');

        await sleep(500);

        setStep('step-quiz', 'done');

        const result = await response.json();

        if (!result.success) throw new Error(result.message || 'Processing failed');

        if (!result.data || result.data.length === 0) {
            throw new Error('No questions found in the JSON data.');
        }

        // Store quiz data
        state.quizData = result.data;
        state.currentIndex = 0;
        state.score = 0;
        state.answered = false;
        state.userAnswers = new Array(result.data.length).fill(null);

        // Show file info
        showFileInfo({ name: 'JSON Quiz Data', size: jsonText.length * 2 }, result.data.length);

        // Render quiz
        showProcessing(false);
        renderQuiz();

    } catch (err) {
        showProcessing(false);
        resetSteps();
        console.error(err);

        const isNetworkError = err instanceof TypeError && err.message.toLowerCase().includes('fetch');
        if (isNetworkError) {
            alert('Cannot reach the backend server.\n\nPlease run this command in your terminal:\n\n  python app.py\n\nThen try again.');
        } else {
            alert('Processing error: ' + err.message);
        }
    }
};

// ── Processing UI Helpers ──────────────────────────────────────────────────────
function showProcessing(show) {
    document.getElementById('upload-zone').style.display = show ? 'none' : 'block';
    document.getElementById('processing-state').classList.toggle('active', show);
    document.getElementById('file-info').style.display = 'none';
}

function setStep(id, status) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (status) el.classList.add(status);
}

function updateLabel(text) {
    const el = document.getElementById('process-label');
    if (el) el.textContent = text;
}

function resetSteps() {
    ['step-upload', 'step-docai', 'step-parse', 'step-quiz'].forEach(id => setStep(id, ''));
}

function showFileInfo(file, questionCount) {
    document.getElementById('upload-zone').style.display = 'none';
    document.getElementById('file-info').style.display = 'block';
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-meta').textContent = `${(file.size / 1024).toFixed(1)} KB · ${questionCount} question${questionCount !== 1 ? 's' : ''} extracted`;
}

window.resetUpload = function () {
    document.getElementById('upload-zone').style.display = 'block';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('pdf-input').value = '';
    // Reset quiz panel
    document.getElementById('quiz-empty').style.display = 'flex';
    document.getElementById('quiz-active').style.display = 'none';
    document.getElementById('quiz-results').style.display = 'none';
    resetSteps();
    state.quizData = [];
    state.userAnswers = [];
};

// ── Quiz Renderer ──────────────────────────────────────────────────────────────
function renderQuiz() {
    document.getElementById('quiz-empty').style.display = 'none';
    document.getElementById('quiz-results').style.display = 'none';
    document.getElementById('quiz-active').style.display = 'block';
    renderQuestion();
}

function renderQuestion() {
    const total = state.quizData.length;
    const idx = state.currentIndex;
    const q = state.quizData[idx];

    state.answered = false;

    // Progress
    const pct = ((idx) / total) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('quiz-progress').textContent = `Question ${idx + 1} of ${total}`;
    document.getElementById('score-badge').textContent = `Score: ${state.score} / ${total}`;
    document.getElementById('q-number').textContent = `Question ${q.number || idx + 1}`;
    document.getElementById('q-text').textContent = q.question;

    // Diagram description (if any)
    const existingDiag = document.getElementById('diagram-desc');
    if (existingDiag) existingDiag.remove();
    if (q.diagram_description) {
        const diag = document.createElement('div');
        diag.id = 'diagram-desc';
        diag.style.cssText = 'background:rgba(100,255,218,0.05);border:1px solid rgba(100,255,218,0.15);border-radius:8px;padding:0.7rem 1rem;margin-bottom:1rem;font-size:0.85rem;color:var(--text-secondary);';
        diag.innerHTML = `<i class="fas fa-image" style="color:var(--accent-green);margin-right:0.5rem;"></i>${q.diagram_description}`;
        document.getElementById('q-text').insertAdjacentElement('afterend', diag);
    }

    // Options — new structure: [{letter, text}]
    const container = document.getElementById('options-group');
    container.innerHTML = '';
    const options = q.options || [];
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'option';
        div.dataset.letter = opt.letter;
        div.innerHTML = `<div class="radio-circle"></div><span><strong>${opt.letter}.</strong> ${opt.text}</span>`;
        div.addEventListener('click', () => handleAnswer(div, opt.letter, q.correct));
        container.appendChild(div);
    });

    // Feedback
    const fb = document.getElementById('feedback-box');
    fb.className = 'feedback-box';
    fb.style.display = 'none';
    fb.innerHTML = '';

    // Nav buttons
    document.getElementById('prev-btn').style.display = idx > 0 ? 'inline-flex' : 'none';
    document.getElementById('next-btn').disabled = true;
    document.getElementById('next-btn').innerHTML = idx === total - 1
        ? 'Finish <i class="fas fa-flag-checkered"></i>'
        : 'Next <i class="fas fa-arrow-right"></i>';
}

function handleAnswer(el, selectedLetter, correctLetter) {
    if (state.answered) return;
    state.answered = true;

    // Store user's answer
    state.userAnswers[state.currentIndex] = selectedLetter;

    const isCorrect = selectedLetter === correctLetter;

    // Lock all options and highlight correct/wrong
    document.querySelectorAll('.option').forEach(opt => {
        opt.classList.add('locked');
        if (opt.dataset.letter === correctLetter) {
            opt.classList.add('correct');
        }
    });

    if (isCorrect) {
        el.classList.add('correct');
        state.score++;
        showFeedback(true, 'Correct!');
    } else {
        el.classList.add('wrong');
        // Find the correct option text for the message
        const correctOpt = state.quizData[state.currentIndex].options.find(o => o.letter === correctLetter);
        const correctText = correctOpt ? `${correctLetter}. ${correctOpt.text}` : correctLetter;
        showFeedback(false, `Incorrect. Correct answer: ${correctText}`);
    }

    // Update score badge immediately
    document.getElementById('score-badge').textContent = `Score: ${state.score} / ${state.quizData.length}`;

    // Enable next
    document.getElementById('next-btn').disabled = false;
}

function showFeedback(correct, msg) {
    const fb = document.getElementById('feedback-box');
    fb.className = 'feedback-box ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML = `<i class="fas fa-${correct ? 'check' : 'times'}-circle"></i> ${msg}`;
}

window.nextQuestion = function () {
    const total = state.quizData.length;
    if (state.currentIndex < total - 1) {
        state.currentIndex++;
        renderQuestion();
    } else {
        showResults();
    }
};

window.prevQuestion = function () {
    if (state.currentIndex > 0) {
        state.currentIndex--;
        renderQuestion();
    }
};

function showResults() {
    document.getElementById('quiz-active').style.display = 'none';
    document.getElementById('quiz-results').style.display = 'block';

    const total = state.quizData.length;
    const pct = Math.round((state.score / total) * 100);

    document.getElementById('final-score').textContent = `${state.score}/${total}`;
    document.getElementById('results-title').textContent = pct >= 80 ? '🎉 Excellent Work!' : pct >= 50 ? '👍 Good Effort!' : '📚 Keep Studying!';
    document.getElementById('results-sub').textContent = `You scored ${pct}% (${state.score} out of ${total} questions correct)`;

    // Generate detailed results
    const resultsContainer = document.getElementById('detailed-results');
    resultsContainer.innerHTML = '';

    state.quizData.forEach((question, index) => {
        const userAnswer = state.userAnswers[index];
        const isCorrect = userAnswer === question.correct;

        const resultItem = document.createElement('div');
        resultItem.className = `result-item ${isCorrect ? 'correct' : 'incorrect'}`;

        const questionText = document.createElement('div');
        questionText.className = 'result-question';
        questionText.innerHTML = `<strong>Question ${question.number}:</strong> ${question.question}`;

        const answerInfo = document.createElement('div');
        answerInfo.className = 'result-answer';

        if (isCorrect) {
            answerInfo.innerHTML = `<span class="correct-answer"><i class="fas fa-check"></i> Correct: ${question.correct}</span>`;
        } else {
            const userOption = question.options.find(opt => opt.letter === userAnswer);
            const correctOption = question.options.find(opt => opt.letter === question.correct);
            answerInfo.innerHTML = `
                <span class="wrong-answer"><i class="fas fa-times"></i> Your answer: ${userAnswer}. ${userOption ? userOption.text : ''}</span><br>
                <span class="correct-answer"><i class="fas fa-check"></i> Correct answer: ${question.correct}. ${correctOption ? correctOption.text : ''}</span>
            `;
        }

        resultItem.appendChild(questionText);
        resultItem.appendChild(answerInfo);
        resultsContainer.appendChild(resultItem);
    });
}

window.restartQuiz = function () {
    state.currentIndex = 0;
    state.score = 0;
    state.answered = false;
    state.userAnswers = new Array(state.quizData.length).fill(null);
    renderQuiz();
};



// ── Road Map ───────────────────────────────────────────────────────────────────
window.markSourceUploaded = function (cardId, input) {
    if (!input.files[0]) return;
    const card = document.getElementById(cardId);
    card.classList.add('uploaded');
    card.querySelector('.source-status').innerHTML = '<i class="fas fa-check-circle"></i> Added';
    state.uploadedSources.add(cardId);

    // Enable generate button if papers uploaded
    if (state.uploadedSources.has('src-papers')) {
        document.getElementById('generate-roadmap-btn').disabled = false;
    }
};

window.generateRoadMap = function () {
    // Show results panel
    document.getElementById('roadmap-empty').style.display = 'none';
    document.getElementById('roadmap-results').style.display = 'block';

    // Build topic list from uploaded sources (real implementation would call backend)
    // For now we show a "processing" message and then display a placeholder
    const listEl = document.getElementById('roadmap-topic-list');
    listEl.innerHTML = `
        <div style="text-align:center; padding:2rem; color:var(--text-secondary);">
            <div class="spinner-ring" style="margin:0 auto 1rem;"></div>
            <p>Analysing sources and ranking topics...</p>
            <p style="font-size:0.8rem; margin-top:0.5rem;">Road Map generation requires backend integration with an LLM. Coming soon.</p>
        </div>
    `;
};

// ── Utility ────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Drag & Drop ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('upload-zone');
    if (!zone) return;

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
            // Manually trigger upload
            const dt = new DataTransfer();
            dt.items.add(file);
            document.getElementById('pdf-input').files = dt.files;
            handleFileUpload({ target: { files: dt.files } });
        }
    });
});
