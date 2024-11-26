import React, { useState } from "react";
import LandingPage from "./components/LandingPage";
import FileUpload from "./components/FileUpload";
import Lobby from "./components/Lobby";
import GamePlay from "./components/GamePlay";

function App() {
    const [currentPage, setCurrentPage] = useState('landing');
    const [gameData, setGameData] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [username, setUsername] = useState('');

    const handleStart = (username, action) => {
        setUsername(username);
        setCurrentPage('upload');
    };

    const startGame = async () => {
        try {
            // Wait until the questions are ready (use polling)
            let questionsReady = false;
            while (!questionsReady) {
                const statusResponse = await fetch("http://localhost:5000/api/status");
                const statusData = await statusResponse.json();
                if (statusData.questionsGenerated) {
                    questionsReady = true;
                } else {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }

            // Once questions are ready, fetch them
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
                />
            );
            
        case 'game':
            return (
                <GamePlay 
                    questions={questions} 
                    onFinish={() => setCurrentPage('landing')}
                />
            );
            
        default:
            return <LandingPage onStart={handleStart} />;
    }
}

export default App;
