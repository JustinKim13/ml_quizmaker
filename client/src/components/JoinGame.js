import React, { useState } from 'react';
import '../styles/JoinGame.css';

const JoinGame = ({ username, onJoin, onBack }) => {
    const [gameCode, setGameCode] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async () => {
        if (gameCode.length !== 6) {
            setError('Please enter a valid 6-character game code');
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/api/join-game`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ gameCode, username }),
            });

            if (!response.ok) {
                throw new Error('Game not found');
            }

            const gameData = await response.json();
            onJoin(gameData);
        } catch (err) {
            setError('Game not found. Please check the code and try again.');
        }
    };

    return (
        <div className="join-container">
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="username">{username}</span>
            </div>
            <div className="join-card">
                <div className="join-content">
                    <h2>Join Game</h2>
                    <div className="form-container">
                        <div className="code-input-group">
                            <input
                                type="text"
                                maxLength="6"
                                value={gameCode}
                                onChange={(e) => {
                                    const value = e.target.value.toUpperCase();
                                    setGameCode(value);
                                    setError('');
                                }}
                                placeholder="ENTER CODE"
                            />
                            {error && <div className="error-message">{error}</div>}
                        </div>
                        <button className="join-button" onClick={handleSubmit}>
                            Join Game
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JoinGame; 