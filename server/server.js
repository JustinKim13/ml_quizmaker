require('dotenv').config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");
const WebSocket = require('ws');
const s3Utils = require('./utils/s3');
const { log, logLevels } = require('./utils/logger');

const app = express(); // create express app instance
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
app.use(express.json());

const activeGames = new Map(); // store active games and players

// Game state management with in-memory storage
const gameState = {
    async getGame(gameCode) {
        return activeGames.get(gameCode) || null;
    },

    async setGame(gameCode, game) {
        activeGames.set(gameCode, game);
    },

    async deleteGame(gameCode) {
        activeGames.delete(gameCode);
    },

    async getAllGames() {
        return Array.from(activeGames.values());
    }
};

// WebSocket connection management with Redis
const wsState = {
    async addConnection(gameCode, wsId) {
        await redis.sadd(`ws:${gameCode}`, wsId);
    },

    async removeConnection(gameCode, wsId) {
        await redis.srem(`ws:${gameCode}`, wsId);
    },

    async getConnections(gameCode) {
        return await redis.smembers(`ws:${gameCode}`);
    }
};

// Remove local file path constants and use S3 paths instead
const S3_PATHS = {
    QUESTIONS: 'questions/questions.json',
    UPLOADS: 'uploads/',
    STATUS: 'status/status.json',
    COMBINED_OUTPUT: 'outputs/combined_output.txt'
};

// Update storage configuration for multer to use memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max file size
        files: 5 // max 5 files per upload
    }
});

// Update clear directory function to use S3
const clearDirectory = async (prefix) => {
    try {
        await s3Utils.clearDirectory(prefix);
    } catch (error) {
        log(logLevels.ERROR, 'Error clearing directory', { error: error.message, prefix });
        throw error;
    }
};

// Update upload endpoint
app.post("/api/upload", async (req, res) => {
    try {
        // Remove any old games for this host
        const username = req.body.username;
        for (const [code, game] of activeGames.entries()) {
            if (game.host === username) {
                activeGames.delete(code);
            }
        }
        await clearDirectory(S3_PATHS.UPLOADS);
        
        // Clear all S3 files to ensure clean start
        await s3Utils.deleteFile(S3_PATHS.QUESTIONS);
        await s3Utils.deleteFile(S3_PATHS.COMBINED_OUTPUT);
        await s3Utils.deleteFile(S3_PATHS.STATUS);
        
        upload.array("files")(req, res, async (err) => {
            if (err) {
                log(logLevels.ERROR, 'Upload error', { error: err.message });
                return res.status(500).json({ error: "File upload failed" });
            }

            const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
            const username = req.body.username;
            const isPrivate = req.body.isPrivate === 'true' || req.body.isPrivate === true;
            const timePerQuestion = parseInt(req.body.timePerQuestion) || 30;
            const numQuestions = parseInt(req.body.numQuestions) || 10;

            // Upload files to S3
            const uploadPromises = req.files.map(file => 
                s3Utils.uploadFile(file, `${S3_PATHS.UPLOADS}${Date.now()}-${file.originalname}`)
            );
            await Promise.all(uploadPromises);

            // Set initial status only once
            const statusData = {
                status: 'processing',
                message: 'Starting PDF extraction...',
                progress: 0,
                total_questions: numQuestions,
                questions_generated: 0,
                timestamp: new Date().toISOString()
            };
            
            await s3Utils.uploadFile(
                { buffer: Buffer.from(JSON.stringify(statusData)), mimetype: 'application/json' },
                S3_PATHS.STATUS
            );

            // Initialize game data
            const gameData = {
                players: [{ name: username, isHost: true }],
                status: 'processing',
                host: username,
                isPrivate: isPrivate,
                questions: [],
                currentQuestion: 0,
                timer: null,
                timeLeft: timePerQuestion,
                timePerQuestion: timePerQuestion,
                numQuestions: numQuestions,
                lastActivity: Date.now()
            };

            await gameState.setGame(gameCode, gameData);

            // Run PDF extraction script
            const extractScript = path.join(__dirname, 'ml_models/data_preprocessing/extract_text_pdf.py');
            const extractProcess = spawn('python3', [extractScript]);
            
            extractProcess.stdout.on('data', (data) => {
                console.log('PDF Extraction:', data.toString());
            }); 
            
            extractProcess.stderr.on('data', (data) => {
                console.error('PDF Extraction Error:', data.toString());
            });

            extractProcess.on('close', async (code) => {
                console.log(`PDF extraction completed with code ${code}`);
                
                if (code === 0) {
                    const videoUrl = req.body.videoUrl;
                    if (videoUrl) {
                        const videoProcess = spawn('python3', [path.join(__dirname, 'ml_models/data_preprocessing/extract_text_url.py')]);
                        videoProcess.stdin.write(videoUrl + '\n');
                        videoProcess.stdin.end();

                        videoProcess.stdout.on('data', (data) => {
                            console.log('Video Processing:', data.toString());
                        }); 
                        
                        videoProcess.stderr.on('data', (data) => {
                            console.error('Video Processing Error:', data.toString());
                        });

                        videoProcess.on('close', async (videoCode) => {
                            console.log(`Video processing completed with code ${videoCode}`);
                            if (videoCode === 0) {
                                const game = activeGames.get(gameCode);
                                if (game) {
                                    game.status = 'Generating questions...';
                                    runQuestionGeneration(gameCode);
                                }
                            }
                        });
                    } else {
                        const game = activeGames.get(gameCode);
                        if (game) {
                            game.status = 'Generating questions...';
                            runQuestionGeneration(gameCode);
                        }
                    }
                } else {
                    console.error('PDF extraction failed with code:', code);
                    const game = activeGames.get(gameCode);
                    if (game) {
                        game.status = 'error';
                        await s3Utils.uploadFile(
                            { 
                                buffer: Buffer.from(JSON.stringify({
                                    status: 'error',
                                    message: 'PDF extraction failed. Please try again.',
                                    progress: 0,
                                    total_questions: numQuestions,
                                    questions_generated: 0,
                                    timestamp: new Date().toISOString()
                                })), 
                                mimetype: 'application/json' 
                            },
                            S3_PATHS.STATUS
                        );
                    }
                }
            });

            console.log("Active games:", Array.from(activeGames.entries()));
            
            res.json({ 
                gameCode,
                players: activeGames.get(gameCode).players,
                isHost: true, 
                isPrivate: isPrivate
            });
        });
    } catch (error) {
        log(logLevels.ERROR, 'Upload error', { error: error.message });
        res.status(500).json({ error: "Failed to process files" });
    }
});

// Update status endpoint
app.get("/api/status", async (req, res) => {
    try {
        const statusFile = await s3Utils.getFile(S3_PATHS.STATUS);
        let status = null;
        if (statusFile) {
            try {
                status = JSON.parse(statusFile);
            } catch (parseError) {
                log(logLevels.ERROR, 'Error parsing status file', { error: parseError.message });
                return res.status(200).json({ 
                    questionsGenerated: false,
                    status: 'error',
                    message: 'Error parsing status file'
                });
            }
        }

        // Check if any game is ready (for this session, just check all active games)
        let gameReady = false;
        let questionsCount = 0;
        for (const game of activeGames.values()) {
            if (game.status === 'ready' && game.questions && game.questions.length > 0) {
                gameReady = true;
                questionsCount = game.questions.length;
                break;
            }
        }

        if (gameReady) {
            return res.status(200).json({
                questionsGenerated: true,
                status: 'ready',
                message: `Questions ready! (${questionsCount} questions generated)`,
                timestamp: status ? status.timestamp : new Date().toISOString()
            });
        }

        if (status) {
            return res.status(200).json({
                questionsGenerated: false,
                status: status.status,
                message: status.message,
                progress: status.progress,
                total_questions: status.total_questions,
                questions_generated: status.questions_generated,
                timestamp: status.timestamp
            });
        } else {
            return res.status(200).json({
                questionsGenerated: false,
                status: 'unknown',
                message: 'Starting...'
            });
        }
    } catch (error) {
        log(logLevels.ERROR, 'Error checking status', { error: error.message });
        res.status(500).json({ 
            questionsGenerated: false,
            status: 'error',
            message: error.message
        });
    }
});

// Update questions endpoint
app.get("/api/questions", async (req, res) => {
    try {
        log(logLevels.INFO, 'Reading questions from S3', { path: S3_PATHS.QUESTIONS });
        
        const questionsFile = await s3Utils.getFile(S3_PATHS.QUESTIONS);
        const questionsData = JSON.parse(questionsFile.toString());
        
        log(logLevels.INFO, 'Sending questions data', { questionCount: questionsData.questions?.length });
        res.status(200).json(questionsData);
    } catch (error) {
        log(logLevels.ERROR, 'Error reading questions', { error: error.message });
        res.status(500).json({
            error: "Error reading questions file",
            details: error.message
        });
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    log(logLevels.ERROR, 'Unhandled error occurred', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
    });
});

// Add request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        log(logLevels.INFO, 'Request completed', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`
        });
    });
    next();
});

// Start server
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024, // 50MB max payload
    handshakeTimeout: process.env.WS_TIMEOUT || 60000,
    heartbeatInterval: process.env.WS_HEARTBEAT_INTERVAL || 30000
});

// Store WebSocket connections with their game codes
const gameConnections = new Map(); // gameCode -> Set of WebSocket connections

wss.on('connection', (ws) => {
    let userGameCode = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            log(logLevels.DEBUG, 'WebSocket message received', { 
                type: data.type,
                gameCode: data.gameCode 
            });
            
            switch (data.type) {
                case 'join_game':
                    userGameCode = data.gameCode;
                    if (!gameConnections.has(userGameCode)) {
                        gameConnections.set(userGameCode, new Set());
                    }
                    gameConnections.get(userGameCode).add(ws);
                    log(logLevels.INFO, 'Player joined game via WebSocket', {
                        gameCode: userGameCode,
                        playerName: data.playerName
                    });

                    broadcastToGame(userGameCode, {
                        type: 'player_count',
                        playerCount: gameConnections.get(userGameCode).size
                    });
                    break;

                case 'start_game':
                    console.log(`Starting game ${data.gameCode}`);
                    const game = activeGames.get(data.gameCode);
                    if (game) {
                        const questionsResponse = await fetch("http://localhost:5000/api/questions");
                        const questionsData = await questionsResponse.json();
                        game.questions = questionsData.questions;

                        game.currentQuestion = 0;
                        game.timeLeft = game.timePerQuestion; // Ensure timer uses user-selected value for first question
                        startGameTimer(data.gameCode);
                        // broadcast game started with proper JSON serialization
                        broadcastToGame(data.gameCode, {
                            type: 'game_started',
                            questions: game.questions,
                            timeLeft: game.timeLeft,
                            timePerQuestion: game.timePerQuestion
                        });
                    }
                    break;

                case 'submit_answer': {
                    const { playerName, gameCode, answer } = data;
                    const game = activeGames.get(gameCode);
                
                    if (!game) {
                        console.error(`Game not found for gameCode: ${gameCode}`);
                        return;
                    }
                
                    if (!game.answeredPlayers) {
                        game.answeredPlayers = new Map();
                    }
                
                    // Check if the player has already answered
                    if (game.answeredPlayers.has(playerName)) {
                        console.log(`Player ${playerName} has already answered`);
                        return;
                    }
                
                    // Record the player's answer and time left
                    game.answeredPlayers.set(playerName, game.timeLeft);
                
                    // Calculate the score for the player
                    const question = game.questions[game.currentQuestion];
                    const isCorrect = answer === question.correct_answer;
                
                    let points = 0;
                    if (isCorrect) {
                        const minPoints = 900;
                        const maxPoints = 1000;
                        const totalTime = game.timePerQuestion || 10; // Use the user-selected time per question
                        const effectiveTimeLeft = Math.min(game.timeLeft, totalTime);
                        points = Math.floor(minPoints + (maxPoints - minPoints) * (effectiveTimeLeft / totalTime));
                    }
                
                    // Find the player and update their score
                    const player = game.players.find((p) => p.name === playerName);
                    if (player) {
                        player.score = (player.score || 0) + points;
                        // Track correct answers
                        if (isCorrect) {
                            player.correct = (player.correct || 0) + 1;
                        }
                    }
                
                    console.log(`Player ${playerName} answered ${isCorrect ? "correctly" : "incorrectly"} with ${game.timeLeft}s left. Points: ${points}`);
                
                    // Broadcast the updated scores and answer state
                    broadcastToGame(gameCode, {
                        type: 'player_answered',
                        playersAnswered: game.answeredPlayers.size,
                        playerTimeLeft: game.timeLeft,
                        playerName,
                        isCorrect,
                        points,
                        totalScore: player ? player.score || 0 : 0,
                        correct: player ? player.correct || 0 : 0,
                    });
                
                    if (game.answeredPlayers.size === game.players.length || game.timeLeft <= 0) {
                        clearInterval(game.timer);
                
                        broadcastToGame(gameCode, {
                            type: 'show_answer',
                            correctAnswer: question.correct_answer,
                            currentQuestion: game.currentQuestion,
                        });
                    }
                    break;
                }                                 
                
                case 'next_question': {
                    const currentGame = activeGames.get(data.gameCode);
                    if (currentGame) {
                        currentGame.currentQuestion = data.currentQuestion; // Update to next question
                        currentGame.answeredPlayers = new Map(); // Reset answered players
                        if (currentGame.currentQuestion >= currentGame.questions.length) {
                            console.log(`Game completed for gameCode: ${data.gameCode}`);
                            broadcastToGame(data.gameCode, {
                                type: 'game_completed',
                            });
                        } else {
                            const currentQuestionData = currentGame.questions[currentGame.currentQuestion]; // Get the current question object
                            broadcastToGame(data.gameCode, {
                                type: "next_question",
                                currentQuestion: currentGame.currentQuestion,
                                playersAnswered: 0,
                                playerCount: currentGame.players.length,
                                context: currentQuestionData.context || "",
                            });
                        }   
                        // Start the timer ONLY after the host triggers "Next Question"
                        startGameTimer(data.gameCode);
                    } else {
                        console.error(`Game not found for gameCode: ${data.gameCode}`);
                    }
                    break;
                }

                case 'show_leaderboard': {
                    const leaderboardGame = activeGames.get(data.gameCode);
                    if (leaderboardGame) {
                        broadcastToGame(data.gameCode, {
                            type: 'show_leaderboard',
                            gameCode: data.gameCode,
                            show: data.show, // Use the correct 'show' value from the client
                        });
                    }
                    break; // Add missing break statement
                }                

                case 'reset_game': {
                    const curGame = activeGames.get(data.gameCode);
                    if (curGame) {
                        curGame.answeredPlayers = new Map();
                        broadcastToGame(data.gameCode, {
                            type: "reset_game", 
                        })
                    }
                }

                case 'game_completed': {
                    const completeGame = activeGames.get(data.gameCode);
                    if (completeGame) {
                        broadcastToGame(data.gameCode, {
                            type: "game_completed",
                        })
                    }
                }

            }
        } catch (error) {
            log(logLevels.ERROR, 'WebSocket message error', {
                error: error.message,
                stack: error.stack,
                gameCode: userGameCode
            });
        }
    });

    ws.on('close', () => {
        if (userGameCode && gameConnections.has(userGameCode)) {
            gameConnections.get(userGameCode).delete(ws);
            log(logLevels.INFO, 'Player left game via WebSocket', { gameCode: userGameCode });
        }
    });
});

function broadcastToGame(gameCode, data) {
    console.log(`Broadcasting to game ${gameCode}:`, data);
    if (gameConnections.has(gameCode)) {
        const message = JSON.stringify(data);
        gameConnections.get(gameCode).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (error) {
                    log(logLevels.ERROR, 'Error sending WebSocket message', {
                        error: error.message,
                        gameCode,
                        messageType: data.type
                    });
                }
            }
        });
    }
}

function startGameTimer(gameCode) {
    const game = activeGames.get(gameCode); // Retrieve the game from activeGames

    if (!game) return;

    if (game.timer) {
        clearInterval(game.timer); // Clear any existing timer
    }

    game.timeLeft = game.timePerQuestion; // Use stored timePerQuestion

    // Start the game timer
    game.timer = setInterval(() => {
        const currentGame = activeGames.get(gameCode); // Access the latest game state
        if (!currentGame) {
            console.error(`Game not found for gameCode: ${gameCode}`);
            clearInterval(game.timer);
            return;
        }

        if (currentGame.timeLeft > 0) {
            currentGame.timeLeft -= 1; // Decrement time
            broadcastToGame(gameCode, {
                type: 'timer_update',
                timeLeft: currentGame.timeLeft,
                currentQuestion: currentGame.currentQuestion,
            });
        } else {
            clearInterval(currentGame.timer);

            const currentQuestion = currentGame.currentQuestion || 0;

            // Ensure the current question is within bounds
            if (currentQuestion >= currentGame.questions.length) {
                broadcastToGame(gameCode, {
                    type: 'game_completed',
                });
                return;
            }

            broadcastToGame(gameCode, {
                type: 'show_answer',
                correctAnswer: currentGame.questions[currentQuestion].correct_answer,
                currentQuestion,
            });

            // Update player progress
            currentGame.players.forEach((player) => {
                broadcastToGame(gameCode, {
                    type: 'player_progress',
                    playerName: player.name,
                    score: player.score || 0, 
                });
            });
        }
    }, 1000); // Run every second
}

// Add this endpoint to handle joining games
app.post("/api/join-game", (req, res) => {
    const { gameCode, username } = req.body;
    log(logLevels.INFO, 'Join game attempt', { gameCode, username });
    
    if (!activeGames.has(gameCode)) {
        log(logLevels.WARN, 'Game not found', { gameCode });
        return res.status(404).json({ error: "Game not found" });
    }

    const game = activeGames.get(gameCode);
    
    // Check if game is full
    const maxPlayers = parseInt(process.env.MAX_PLAYERS_PER_GAME) || 50;
    if (game.players.length >= maxPlayers) {
        log(logLevels.WARN, 'Game is full', { gameCode, currentPlayers: game.players.length, maxPlayers });
        return res.status(400).json({ error: "Game is full" });
    }

    // Check if username is already taken in this game
    if (game.players.some(player => player.name === username)) {
        log(logLevels.WARN, 'Username already taken', { gameCode, username });
        return res.status(400).json({ error: "Username already taken in this game" });
    }

    // Update last activity timestamp
    game.lastActivity = Date.now();
    
    game.players.push({ name: username, isHost: false });
    
    log(logLevels.INFO, 'Player joined game', { 
        gameCode, 
        username, 
        playerCount: game.players.length 
    });
    
    res.json({ 
        gameCode,
        players: game.players,
        isHost: false
    });
});

// Add an endpoint to get list of active games
app.get("/api/active-games", (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filter games that are:
    // 1. Not private
    // 2. Have players
    // 3. Are actually in progress (not just created)
    const games = Array.from(activeGames.entries())
        .filter(([_, game]) => {
            return !game.isPrivate && 
                   game.players.length > 0 && 
                   game.status !== 'processing' &&
                   game.questions && 
                   game.questions.length > 0;
        })
        .map(([code, game]) => ({
            gameCode: code,
            playerCount: game.players.length,
            maxPlayers: process.env.MAX_PLAYERS_PER_GAME || 50,
            timePerQuestion: game.timePerQuestion,
            numQuestions: game.numQuestions,
            currentQuestion: game.currentQuestion,
            status: game.status
        }))
        .sort((a, b) => b.playerCount - a.playerCount); // Sort by player count

    const totalGames = games.length;
    const paginatedGames = games.slice(skip, skip + limit);

    console.log("Filtered active games:", {
        total: totalGames,
        page,
        limit,
        games: paginatedGames
    });

    res.json({ 
        games: paginatedGames,
        pagination: {
            total: totalGames,
            page,
            limit,
            totalPages: Math.ceil(totalGames / limit)
        }
    });
});

// Add this endpoint to get players for a specific game
app.get("/api/game/:gameCode/players", (req, res) => {
    const { gameCode } = req.params;
    const game = activeGames.get(gameCode);
    
    if (!game) {
        return res.status(404).json({ 
            error: "Game not found",
            hostLeft: true  // Indicate that the game no longer exists
        });
    }
    
    res.json({ 
        players: game.players,
        status: game.status,
        hostLeft: false
    });
});

// Add this endpoint to start the game
app.post("/api/game/:gameCode/start", async (req, res) => {
    // This endpoint includes questions in the broadcast
    const questionsResponse = await fetch("http://localhost:5000/api/questions");
    const questionsData = await questionsResponse.json();
    
    broadcastToGame(gameCode, {
        type: 'game_started',
        questions: questionsData.questions
    });
    
    res.json({ success: true });
});

// Helper function to run question generation
function runQuestionGeneration(gameCode) {
    const questionScript = path.join(__dirname, 'ml_models/models/t5_model.py');
    const game = activeGames.get(gameCode); // Get the correct game
    if (!game) {
        console.error(`No game found for gameCode: ${gameCode}`);
        return;
    }

    console.log(`Starting question generation for game ${gameCode} with ${game.numQuestions} questions`);
    
    // Set initial status without clearing the file
    const initialStatus = {
        status: 'processing',
        message: 'Starting question generation...',
        progress: 20,  // Start from 20% since PDF extraction is done
        total_questions: game.numQuestions,
        questions_generated: 0,
        timestamp: new Date().toISOString()
    };

    // Write initial status and wait for it to complete
    s3Utils.uploadFile(
        { buffer: Buffer.from(JSON.stringify(initialStatus)), mimetype: 'application/json' },
        S3_PATHS.STATUS
    )
    .then(() => {
        // Add a longer delay to ensure S3 consistency
        return new Promise(resolve => setTimeout(resolve, 2000));
    })
    .then(() => {
        // Check if game is still active before starting question generation
        const currentGame = activeGames.get(gameCode);
        if (!currentGame) {
            console.log(`Game ${gameCode} no longer exists, stopping question generation`);
            return;
        }

        const questionProcess = spawn('python3', [questionScript, '--num_questions', game.numQuestions.toString(), '--game_code', gameCode]);
        
        let stdoutData = '';
        let stderrData = '';
        
        questionProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            console.log('Question Generation:', output);
        });

        questionProcess.stderr.on('data', (data) => {
            const error = data.toString();
            stderrData += error;
            console.error('Question Generation Error:', error);
        });

        questionProcess.on('close', async (code) => {
            console.log(`Question generation completed with code ${code}`);
            const game = activeGames.get(gameCode);
            if (!game) {
                console.log(`Game ${gameCode} no longer exists, skipping question processing`);
                return;
            }

            if (code === 0) {
                console.log('Question generation successful');
                // Add a delay before trying to read the questions
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try to load questions from S3
                try {
                    const questionsFile = await s3Utils.getFile(S3_PATHS.QUESTIONS);
                    const questionsData = JSON.parse(questionsFile);
                    if (questionsData.questions && questionsData.questions.length > 0) {
                        game.questions = questionsData.questions;
                        game.status = 'ready';
                        broadcastToGame(gameCode, {
                            type: 'game_ready',
                            questionsCount: questionsData.questions.length
                        });
                    } else {
                        game.status = 'error';
                        broadcastToGame(gameCode, {
                            type: 'game_error',
                            message: 'No questions were generated. Please try again with a different file.'
                        });
                        console.error('No questions generated');
                    }
                } catch (err) {
                    console.error('Failed to load questions after generation:', err);
                    // Add a retry with delay
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    try {
                        const questionsFile = await s3Utils.getFile(S3_PATHS.QUESTIONS);
                        const questionsData = JSON.parse(questionsFile);
                        if (questionsData.questions && questionsData.questions.length > 0) {
                            game.questions = questionsData.questions;
                            game.status = 'ready';
                            broadcastToGame(gameCode, {
                                type: 'game_ready',
                                questionsCount: questionsData.questions.length
                            });
                        } else {
                            game.status = 'error';
                            broadcastToGame(gameCode, {
                                type: 'game_error',
                                message: 'No questions were generated. Please try again with a different file.'
                            });
                        }
                    } catch (retryErr) {
                        game.status = 'error';
                        broadcastToGame(gameCode, {
                            type: 'game_error',
                            message: 'Failed to load questions after generation. Please try again.'
                        });
                        console.error('Failed to load questions after retry:', retryErr);
                    }
                }
            } else {
                console.error('Question generation failed:', stderrData);
                if (game) {
                    game.status = 'error';
                    broadcastToGame(gameCode, {
                        type: 'game_error',
                        message: 'Question generation failed. Please try again.'
                    });
                }
            }
        });

        questionProcess.on('error', (error) => {
            console.error('Failed to start question generation:', error);
            const game = activeGames.get(gameCode);
            if (game) {
                game.status = 'error';
            }
        });
    })
    .catch(error => {
        console.error('Failed to write initial status:', error);
        const game = activeGames.get(gameCode);
        if (game) {
            game.status = 'error';
            broadcastToGame(gameCode, {
                type: 'game_error',
                message: 'Failed to start question generation. Please try again.'
            });
        }
    });
}

// Add these new endpoints
app.post("/api/game/:gameCode/leave", async (req, res) => {
    try {
        const { gameCode } = req.params;
        const { username } = req.body;
        
        const game = activeGames.get(gameCode);
        if (!game) {
            return res.status(404).json({ error: "Game not found" });
        }

        // Remove player from game
        game.players = game.players.filter(p => p.name !== username);
        
        // If host left or no players left, clean up the game
        if (game.host === username || game.players.length === 0) {
            // Clear questions and status
            await s3Utils.deleteFile(S3_PATHS.QUESTIONS);
            await s3Utils.deleteFile(S3_PATHS.STATUS);
            await s3Utils.deleteFile(S3_PATHS.COMBINED_OUTPUT);
            
            // Remove game from active games
            activeGames.delete(gameCode);
            
            // Notify remaining players that host left
            if (game.host === username) {
                broadcastToGame(gameCode, {
                    type: 'host_left'
                });
            }
        } else {
            // Update game state
            await gameState.setGame(gameCode, game);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error leaving game:', error);
        res.status(500).json({ error: "Failed to leave game" });
    }
});

// Add game cleanup function
function cleanupInactiveGames() {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const MAX_ACTIVE_GAMES = 100; // Maximum number of active games

    for (const [gameCode, game] of activeGames.entries()) {
        if (now - game.lastActivity > INACTIVE_TIMEOUT) {
            log(logLevels.INFO, 'Cleaning up inactive game', { 
                gameCode,
                lastActivity: new Date(game.lastActivity).toISOString()
            });
            activeGames.delete(gameCode);
            if (gameConnections.has(gameCode)) {
                gameConnections.delete(gameCode);
            }
        }
    }

    if (activeGames.size > MAX_ACTIVE_GAMES) {
        const gamesToRemove = Array.from(activeGames.entries())
            .sort((a, b) => a[1].lastActivity - b[1].lastActivity)
            .slice(0, activeGames.size - MAX_ACTIVE_GAMES);

        for (const [gameCode, _] of gamesToRemove) {
            log(logLevels.INFO, 'Removing excess game', { 
                gameCode,
                totalGames: activeGames.size,
                maxGames: MAX_ACTIVE_GAMES
            });
            activeGames.delete(gameCode);
            if (gameConnections.has(gameCode)) {
                gameConnections.delete(gameCode);
            }
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupInactiveGames, 5 * 60 * 1000);

app.get("/api/game/:gameCode/status", async (req, res) => {
    try {
        const { gameCode } = req.params;
        const game = activeGames.get(gameCode);
        
        if (!game) {
            return res.status(404).json({ 
                status: 'error',
                message: 'Game not found'
            });
        }
        
        res.json({
            status: game.status,
            message: game.status === 'processing' ? 'Question generation in progress' : 'Game is active'
        });
    } catch (error) {
        console.error('Error checking game status:', error);
        res.status(500).json({ error: "Failed to check game status" });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});