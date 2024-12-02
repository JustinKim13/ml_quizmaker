import React, { useState, useEffect } from 'react';
import '../styles/Lobby.css';

const Lobby = ({ gameData, startGame, onBack }) => {
    const [isProcessing, setIsProcessing] = useState(gameData.isHost);
    const [questions, setQuestions] = useState(null);
    const [statusMessage, setStatusMessage] = useState(gameData.isHost ? 'Starting...' : 'Waiting for host...');
    const [progress, setProgress] = useState(0);
    const [players, setPlayers] = useState([{ 
        name: gameData?.playerName, 
        isHost: gameData?.isHost 
    }]);
    const [hostLeft, setHostLeft] = useState(false);

    useEffect(() => {
        let pollInterval;
        
        const checkStatus = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/status');
                const data = await response.json();
                
                if (gameData.isHost) {
                    switch(data.status) {
                        case 'processing':
                            setStatusMessage(data.message || 'Processing...');
                            setProgress(prev => (prev < 90 ? prev + 2 : prev));
                            break;
                        case 'completed':
                            const questionsResponse = await fetch('http://localhost:5000/api/questions');
                            const questionsData = await questionsResponse.json();
                            
                            if (questionsData.questions && questionsData.questions.length > 0) {
                                setQuestions(questionsData.questions);
                                setIsProcessing(false);
                                setStatusMessage('Questions ready!');
                                setProgress(100);
                            }
                            break;
                        case 'error':
                            setStatusMessage(`Error: ${data.error}`);
                            setIsProcessing(false);
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
                
                const hostPlayer = data.players.find(p => p.isHost);
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
        checkGameStatus(); // Initial check

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

    const handleLeave = async () => {
        try {
            const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: gameData.playerName
                })
            });

            if (!response.ok) {
                throw new Error('Failed to leave game');
            }

            const data = await response.json();
            console.log(`Successfully left game. ${data.wasHost ? 'Game deleted' : 'Player removed'}`);
            onBack();

        } catch (error) {
            console.error('Error leaving game:', error);
            onBack();
        }
    };

    return (
        <div className="lobby">
            <div className="animated-background"></div>
            <div className="back-button" onClick={handleLeave}>
                ← Back
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
                            {Array.isArray(players) && players.map((player, index) => (
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
                            <div 
                                className="progress-fill" 
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                        <p className="status-message">{statusMessage}</p>
                    </div>
                ) : questions ? (
                    <div className="questions-ready">
                        <div className="success-icon">✓</div>
                        <h3>Questions are ready!</h3>
                        {gameData.isHost && (
                            <button onClick={startGame} className="start-game-button">
                                Start Game
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="waiting-message">
                        <p>{statusMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Lobby;
