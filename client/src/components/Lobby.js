import React, { useState, useEffect } from 'react';
import '../styles/Lobby.css';

const Lobby = ({ gameData, startGame, onBack }) => {
    const [isProcessing, setIsProcessing] = useState(gameData.isHost);
    const [questions, setQuestions] = useState(null);
    const [statusMessage, setStatusMessage] = useState(gameData.isHost ? 'Starting...' : 'Waiting for host...');
    const [progress, setProgress] = useState(0);
    const [players, setPlayers] = useState([{ name: gameData?.playerName, isHost: gameData?.isHost }]);
    const [hostLeft, setHostLeft] = useState(false);
    const [ws, setWs] = useState(null);

    // Handle page refresh or back navigation
    useEffect(() => {
        const handleBeforeUnload = async (event) => {
            // Notify the server that the user is leaving
            event.preventDefault();
            try {
                await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: gameData.playerName }),
                });
                console.log("User removed from game due to page reload or back navigation.");
            } catch (error) {
                console.error("Error notifying server of user inactivity:", error);
            }
            return (event.returnValue = "Are you sure you want to leave?");
        };

        const handlePopState = async () => {
            // Triggered on back button
            try {
                await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: gameData.playerName }),
                });
                console.log("User removed from game due to back navigation.");
                onBack(); // Trigger the back functionality
            } catch (error) {
                console.error("Error notifying server of user inactivity on back:", error);
            }
        };

        // Add event listeners
        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("popstate", handlePopState);

        // Cleanup listeners on unmount
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("popstate", handlePopState);
        };
    }, [gameData.gameCode, gameData.playerName, onBack]);

    useEffect(() => {
        let pollInterval;

        const checkStatus = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/status');
                const data = await response.json();

                if (gameData.isHost) {
                    switch (data.status) {
                        case 'processing':
                        case 'pdf_extracted': {
                            // Custom status message logic
                            if (typeof data.questions_generated === 'number' && typeof data.total_questions === 'number') {
                                if (data.questions_generated === 0) {
                                    setStatusMessage('Loading models...');
                                } else {
                                    setStatusMessage(`Generated ${data.questions_generated} of ${data.total_questions} questions...`);
                                }
                            } else {
                                setStatusMessage(data.message || 'Processing...');
                            }
                            setProgress(
                                data.progress !== undefined
                                    ? data.progress
                                    : (prev) => (prev < 95 ? prev + 2 : prev)
                            );
                            break;
                        }
                        case 'ready':
                            // Fetch questions and show ready UI
                            const fetchQuestions = async () => {
                                const questionsResponse = await fetch('http://localhost:5000/api/questions');
                                const questionsData = await questionsResponse.json();
                                if (questionsData.questions && questionsData.questions.length > 0) {
                                    setQuestions(questionsData.questions);
                                    setIsProcessing(false);
                                    setStatusMessage(`Questions ready! (${questionsData.questions.length} questions generated)`);
                                    setProgress(100);
                                } else {
                                    setStatusMessage('Questions are ready, but none were found.');
                                    setIsProcessing(false);
                                }
                            };
                            fetchQuestions();
                            break;
                        case 'error':
                            setStatusMessage(`Error: ${data.message || data.error}`);
                            setIsProcessing(false);
                            break;
                        default:
                            setStatusMessage(data.message || 'Working...');
                            break;
                    }
                } else {
                    setStatusMessage('Waiting for host to start the game...');
                }
            } catch (error) {
                console.error('Error checking status:', error);
            }
        };

        if (isProcessing && gameData.isHost) {
            pollInterval = setInterval(checkStatus, 1000);
            checkStatus();
        }

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [isProcessing, gameData.isHost]);

    useEffect(() => {
        let pollInterval;

        const checkGameStatus = async () => {
            try {
                const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/players`);
                if (!response.ok) {
                    console.log("Game no longer exists - host likely left");
                    setHostLeft(true);
                    onBack();
                    return;
                }

                const data = await response.json();
                setPlayers(data.players);

                const hostPlayer = data.players.find((p) => p.isHost);
                if (!hostPlayer) {
                    console.log("Host left the game - returning to previous screen");
                    setHostLeft(true);
                    onBack();
                    return;
                }
            } catch (error) {
                console.error('Error checking game status:', error);
                setHostLeft(true);
                onBack();
            }
        };

        pollInterval = setInterval(checkGameStatus, 1000);
        checkGameStatus();

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [gameData.gameCode, onBack]);

    useEffect(() => {
        if (hostLeft && !gameData.isHost) {
            alert("The host has left the game. You will be returned to the join screen.");
        }
    }, [hostLeft, gameData.isHost]);

    useEffect(() => {
        const websocket = new WebSocket('ws://localhost:5000');
        
        websocket.onopen = () => {
            console.log('WebSocket Connected');
            websocket.send(JSON.stringify({
                type: 'join_game',
                gameCode: gameData.gameCode,
                playerName: gameData.playerName
            }));
        };

        websocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log('Received WebSocket message:', data);
            
            if (data.type === 'game_started') {
                console.log('Game started message received');
                await startGame();
            }
        };

        setWs(websocket);

        return () => {
            if (websocket) {
                websocket.close();
            }
        };
    }, [gameData.gameCode, gameData.playerName, startGame]);

    const handleLeave = async () => {
        try {
            const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: gameData.playerName }),
            });

            if (!response.ok) {
                throw new Error('Failed to leave game');
            }

            console.log("User successfully left the game.");
            onBack();
        } catch (error) {
            console.error('Error leaving game:', error);
            onBack();
        }
    };

    const handleStartGame = async () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending game start message');
            ws.send(JSON.stringify({
                type: 'start_game',
                gameCode: gameData.gameCode
            }));
        }
        await startGame(); // Host also starts the game
    };

    return (
        <div className="lobby">
            <div className="animated-background"></div>
            <div className="back-button" onClick={handleLeave}>
                ← Back
            </div>
            <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="username">{gameData.playerName}</span>
            </div>
            <div className="lobby-card">
                <h2>Game Lobby</h2>
                <div className="game-info">
                    <div className="info-item">
                        <span className="label">Game Code</span>
                        <span className="game-code">{gameData?.gameCode}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Players</span>
                        <div className="players-list">
                            {Array.isArray(players) &&
                                players.map((player, index) => (
                                    <div key={index} className="player-item">
                                        <span className="player-name">{player.name}</span>
                                        {player.isHost && <span className="host-badge">Host</span>}
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>

                {isProcessing ? (
                    <div className="loading-container">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        {/* Show live question progress if available */}
                        {gameData.isHost && (
                            <>
                                {statusMessage && <p className="status-message">{statusMessage}</p>}
                            </>
                        )}
                        {!gameData.isHost && <p className="status-message">{statusMessage}</p>}
                    </div>
                ) : questions ? (
                    <div className="questions-ready">
                        <div className="success-icon">✓</div>
                        <h3>Questions are ready!</h3>
                        {gameData.isHost ? (
                            <button onClick={handleStartGame} className="start-game-button">
                                Start Game
                            </button>
                        ) : (
                            <p>Waiting for host to start the game...</p>
                        )}
                    </div>
                ) : (
                    <div className="status-message">
                        <p>{statusMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Lobby;
