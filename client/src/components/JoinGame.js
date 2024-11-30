import React, { useState, useEffect } from 'react';
import '../styles/JoinGame.css';

const JoinGame = ({ username, onJoin, onBack }) => {
    const [gameCode, setGameCode] = useState('');
    const [error, setError] = useState('');
    const [activeGames, setActiveGames] = useState([]);

    useEffect(() => {
        const fetchGames = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/active-games');
                const data = await response.json();
                setActiveGames(data.games);
            } catch (err) {
                console.error('Error fetching games:', err);
            }
        };

        fetchGames();
        const interval = setInterval(fetchGames, 5000); // Poll every 5 seconds
        return () => clearInterval(interval);
    }, []);

    const handleJoin = async (code) => {
        try {
            const response = await fetch('http://localhost:5000/api/join-game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    gameCode: code || gameCode, 
                    username 
                }),
            });

            if (!response.ok) {
                throw new Error('Game not found');
            }

            const data = await response.json();
            onJoin(data);
        } catch (err) {
            setError('Game not found. Please check the code and try again.');
        }
    };

    return (
        <div className="join-container">
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            <div className="join-card">
                <div className="join-content">
                    <h2>Join Game</h2>
                    
                    {/* Manual code entry */}
                    <div className="code-input-group">
                        <input
                            type="text"
                            maxLength="6"
                            value={gameCode}
                            onChange={(e) => {
                                setGameCode(e.target.value.toUpperCase());
                                setError('');
                            }}
                            placeholder="ENTER CODE"
                        />
                        <button 
                            className="join-button" 
                            onClick={() => handleJoin()}
                        >
                            Join Game
                        </button>
                        {error && <div className="error-message">{error}</div>}
                    </div>

                    {/* Available games list */}
                    {activeGames.length > 0 && (
                        <div className="available-games">
                            <h3>Available Games</h3>
                            <div className="games-list">
                                {activeGames.map((game) => (
                                    <div 
                                        key={game.gameCode} 
                                        className="game-item"
                                        onClick={() => handleJoin(game.gameCode)}
                                    >
                                        <span className="game-code">{game.gameCode}</span>
                                        <span className="player-count">
                                            {game.playerCount} player{game.playerCount !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default JoinGame; 