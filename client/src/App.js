import React, { useState } from "react";
import LandingPage from "./components/LandingPage";
import FileUpload from "./components/FileUpload";
import Lobby from "./components/Lobby";
import GamePlay from "./components/GamePlay";
import JoinGame from "./components/JoinGame";
import './styles/shared/ButtonStyles.css';
import './styles/Gradient.css';

function App() {
    const [currentPage, setCurrentPage] = useState('landing');
    const [gameData, setGameData] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [username, setUsername] = useState('');

    const handleStart = (username, action) => {
        setUsername(username);
        setCurrentPage(action === 'create' ? 'upload' : 'join');
    };

    const startGame = async () => {
        if (!gameData?.gameCode) return;

        try {
            // Host notifies server that game is starting
            if (gameData.isHost) {
                await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/start`, {
                    method: 'POST'
                });
            }

            // Get questions (they should already be generated by host)
            const response = await fetch("http://localhost:5000/api/questions");
            const data = await response.json();
            
            if (data.questions) {
                setQuestions(data.questions);
                setCurrentPage('game');
            } else {
                throw new Error("No questions found in response");
            }
        } catch (error) {
            console.error("Error starting the game:", error);
            alert("An error occurred while starting the game. Please try again.");
        }
    };

    // Render the appropriate component based on currentPage
    switch (currentPage) {
        case 'landing':
            return <LandingPage onStart={handleStart} />;
            
        case 'upload':
            return (
                <FileUpload 
                    username={username}
                    setGameData={(data) => {
                        setGameData({...data, playerName: username});
                        setCurrentPage('lobby');
                    }}
                    onBack={() => setCurrentPage('landing')}
                />
            );
            
        case 'lobby':
            return gameData && (
                <Lobby 
                    gameData={gameData}
                    startGame={startGame}
                    onBack={() => setCurrentPage('upload')}
                />
            );
            
        case 'game':
            return (
                <GamePlay 
                    questions={questions} 
                    onFinish={() => setCurrentPage('lobby')}
                />
            );
            
        case 'join':
            return <JoinGame 
                username={username}
                onJoin={(gameData) => {
                    setGameData(gameData);
                    setCurrentPage('lobby');
                }}
                onBack={() => setCurrentPage('landing')}
            />;
            
        default:
            return <LandingPage onStart={handleStart} />;
    }
}

export default App;
