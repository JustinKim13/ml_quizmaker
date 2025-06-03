# QuizClash - AI-Powered Multiplayer Quiz Platform

A sophisticated multiplayer quiz application that uses machine learning to automatically generate questions from PDF documents and YouTube videos. Built with React, Node.js/Express, WebSocket real-time communication, and advanced NLP models.

## Features

### Core Functionality
- **PDF-to-Quiz Generation**: Upload PDFs and automatically extract questions using T5-base and NLP models
- **Video-to-Quiz Generation**: Process YouTube videos with OCR and transcript analysis
- **Real-time Multiplayer**: WebSocket-powered live quiz sessions with up to 8 players
- **Intelligent Question Generation**: 
  - Multiple choice questions with AI-generated distractors
  - Question-answer pairs extracted from document context
  - Smart answer validation with case-insensitive matching
- **Responsive Game Interface**: Modern React UI with real-time score tracking and player management
- **Cloud Storage**: AWS S3 integration for file management and processing

### Technical Highlights
- **Machine Learning Pipeline**: T5-base for question generation, advanced text preprocessing
- **Real-time Communication**: WebSocket server handling concurrent player sessions
- **Document Processing**: Advanced PDF text extraction with PyPDF and OCR capabilities
- **Video Processing**: YouTube video analysis with Tesseract OCR
- **Cloud Integration**: AWS S3 for scalable file storage and processing
- **RESTful API**: Clean Express.js backend with comprehensive error handling

## Tech Stack

### Frontend
- **React 18** - Modern component-based UI with hooks
- **CSS3** - Responsive design with custom styling
- **WebSocket Client** - Real-time communication
- **Particles.js** - Interactive background effects

### Backend
- **Node.js/Express** - High-performance server framework
- **WebSocket (ws)** - Native WebSocket server implementation
- **Multer** - File upload handling with memory storage
- **AWS SDK** - S3 integration for cloud storage
- **CORS** - Cross-origin resource sharing

### Machine Learning & Processing
- **Python 3.8+** - ML model execution environment
- **T5-base** - Question generation model
- **Transformers** - Hugging Face model integration
- **PyPDF** - PDF text extraction
- **Tesseract OCR** - Image and video text recognition
- **pdf2image** - PDF to image conversion
- **scikit-learn** - Text processing and similarity metrics

### Cloud Services
- **AWS S3** - File storage and management

## Installation

### Prerequisites
- Node.js 16+
- npm or yarn
- Python 3.8+ (for ML models)
- AWS account (for S3 storage)

### Backend Setup
```bash
# Clone the repository
git clone https://github.com/JustinKim13/ml_quizmaker.git
cd quizclash

# Install server dependencies
cd server
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your AWS credentials and configuration

# Set up Python environment for ML models
python -m venv env
source env/bin/activate  # On Windows: env\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
pip install -r ml_models/requirements.txt

# Download required spaCy model
python -m spacy download en_core_web_sm

# Download the s2v_reddit_2015_md model from GitHub releases for distractor generation
curl -L "https://github.com/explosion/sense2vec/releases/download/v1.0.0/s2v_reddit_2015_md.tar.gz" -o s2v_reddit_2015_md.tar.gz
tar -xzf s2v_reddit_2015_md.tar.gz
mkdir -p ml_models/models
mv s2v_old ml_models/models/
rm -f s2v_reddit_2015_md.tar.gz

# Start the Node.js server in development mode
npm run dev
```

### Frontend Setup
```bash
# Install client dependencies (in a new terminal)
cd client
npm install

# Start the React development server
npm start
```

## Configuration

### Environment Variables
Create a `.env` file in the server directory:
```env
# Server Configuration
PORT=5000
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development

# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-s3-bucket-name
```

### AWS S3 Setup
1. Create an AWS S3 bucket
2. Set up appropriate IAM permissions for read/write access
3. Configure bucket CORS if needed for direct uploads

## Usage

1. **Start the Application**
   - Server runs on `http://localhost:5000` (with `npm run dev`)
   - Client runs on `http://localhost:3000` (with `npm start`)
   - ML models run as separate Python processes when needed

2. **Create a Quiz Session**
   - Upload PDF documents or provide YouTube video URLs
   - Configure quiz settings (number of questions, time per question)
   - Wait for automatic question generation
   - Share the room code with other players

3. **Join a Quiz**
   - Enter a room code
   - Wait for the host to start the game
   - Answer questions in real-time

4. **Gameplay**
   - Each question has a customizable timer (default 30 seconds)
   - Points awarded based on speed and accuracy
   - Real-time leaderboard updates
   - Support for both private and public games

## API Endpoints

### Quiz Management
- `POST /api/upload` - Upload files and create quiz session
- `GET /api/status` - Check quiz generation status  
- `GET /api/questions` - Get generated questions
- `POST /api/join-game` - Join existing game room

### WebSocket Events
- `join_room` - Player joins quiz room
- `start_game` - Host starts the quiz
- `submit_answer` - Player submits answer
- `next_question` - Progress to next question
- `game_complete` - End of quiz results
- `player_update` - Real-time player status updates

## Project Structure

```
ml_quiz_project/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   │   ├── FileUpload.js
│   │   │   ├── GamePlay.js
│   │   │   ├── GameOver.js  
│   │   │   ├── JoinGame.js
│   │   │   ├── LandingPage.js
│   │   │   └── Lobby.js
│   │   ├── styles/       # CSS styling
│   │   └── App.js        # Main application
│   └── package.json      # Frontend dependencies
├── server/                # Node.js backend
│   ├── server.js         # Main Express application
│   ├── utils/           # Utility functions (S3, logging)
│   │   ├── s3.js        # AWS S3 operations
│   │   └── logger.js    # Logging utilities
│   ├── ml_models/       # Machine learning components
│   │   ├── models/      # ML model implementations
│   │   ├── data_preprocessing/  # PDF/video processing
│   │   └── requirements.txt    # Python ML dependencies
│   ├── cleanup_old_games.js    # Game cleanup utility
│   ├── package.json     # Backend dependencies
│   └── requirements.txt # Basic Python dependencies
└── README.md
```

## Performance & Limitations

### Memory Requirements
- **ML Models**: ~500MB for T5-base and supporting models
- **Concurrent Processing**: Memory usage scales with active quiz sessions
- **File Processing**: Supports files up to 100MB per upload

### Development Notes
- Models are downloaded automatically on first use
- Local development requires stable internet for initial model downloads
- S3 storage required for file persistence and multi-instance scaling

## Development

### Running in Development
```bash
# Start backend with auto-reload
cd server
npm run dev

# Start frontend with hot reload
cd client
npm start
```

### Common Development Tasks
```bash
# Clear old game data
node server/cleanup_old_games.js

# Check Python dependencies
python server/ml_models/check_dependencies.py

# Test file upload
curl -X POST -F "files=@test.pdf" http://localhost:5000/api/upload
```

## Troubleshooting

### Common Issues

**Models not loading**
- Ensure stable internet connection for initial model download
- Check Python environment activation
- Verify all dependencies in requirements.txt are installed
- If you get "Sense2Vec model directory not found" error, run the Sense2Vec download command from the setup instructions

**File upload fails**
- Check AWS S3 credentials and permissions
- Verify file size is under 100MB limit
- Ensure S3 bucket exists and is accessible

**WebSocket connection issues**
- Verify server is running on correct port
- Check CORS configuration for WebSocket connections
- Monitor server logs for connection errors

### Performance Tips
- Use PDFs with clear, structured text for best question generation
- YouTube videos with clear audio/visuals work best for processing
- Monitor AWS costs for S3 storage and data transfer
- Current implementation uses in-memory storage, consider external storage for production scaling

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Hugging Face Transformers library for ML models
- Express.js and React communities for development frameworks
- Tesseract OCR for video text extraction